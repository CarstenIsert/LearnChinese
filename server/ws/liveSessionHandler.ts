import { LiveServerMessage, Modality } from '@google/genai';
import type http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { analyzeAndPersistSession, TranscriptEntry } from '../analyzer.ts';
import {
  AuthUser,
  createInMemoryRateLimiter,
  getAuthenticatedUserFromRequest,
  isAuthEnforced,
} from '../auth.ts';
import {
  addMemoryFact,
  createSessionRecord,
  DEFAULT_USER_ID,
  getAllPersonas,
  getLearnerProfile,
  getPersonaById,
  getScenarioById,
  recordVocabularyReview,
  saveOrUpdateVocabulary,
  updateLearnerProfile,
  upsertPersona,
} from '../db.ts';
import { selectSessionMemoryContext } from '../memory.ts';
import {
  buildOnboardingSystemPrompt,
  buildSystemPrompt,
  LIVE_TOOLS_DECLARATIONS,
  ONBOARDING_TOOLS_DECLARATIONS,
} from '../prompts.ts';
import { getApiKey, getGeminiClient, hasValidApiKey } from '../services/geminiClient.ts';
import { buildWavBase64FromPcm16, computePcm16Rms } from '../services/tts.ts';

const MAX_CONCURRENT_WS_PER_USER = 2;
const MAX_WS_SESSION_MS = 75 * 60 * 1000; // 75 minutes
const MAX_BUFFERED_PCM_BYTES = 4_800_000; // ~150s of 16kHz 16-bit mono speech

const wsSessionStartLimiter = createInMemoryRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  errorMessage: 'Zu viele Gesprächsstarts in der letzten Stunde. Bitte warte kurz.',
});

const wsTextInputLimiter = createInMemoryRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 60,
  errorMessage: 'Zu viele Textnachrichten in kurzer Zeit. Bitte warte kurz.',
});

function isSameOriginUpgrade(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachLiveWebSocketServer(server: http.Server, liveModel: string): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const activeWsCountByUser = new Map<number, number>();

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/ws/live' || !isSameOriginUpgrade(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = getAuthenticatedUserFromRequest(req);
    if (!user && isAuthEnforced()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (clientWs: WebSocket, _req: http.IncomingMessage, user: AuthUser | null) => {
    const userId = user?.id ?? DEFAULT_USER_ID;
    const currentActive = activeWsCountByUser.get(userId) || 0;
    if (currentActive >= MAX_CONCURRENT_WS_PER_USER) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            'Es sind bereits zu viele aktive Gespräche geöffnet. Bitte schließe zuerst andere Tabs.',
        })
      );
      clientWs.close(1008, 'Too many concurrent sessions');
      return;
    }
    activeWsCountByUser.set(userId, currentActive + 1);

    let geminiSession: any = null;
    let currentSessionDbId: number | null = null;
    let currentPersonaId = 'coach-lin';
    let currentScenarioId: string | undefined = undefined;
    let isOnboardingMode = false;
    let sessionStartMs = 0;
    let maxSessionTimer: ReturnType<typeof setTimeout> | null = null;
    let greetingTimer: ReturnType<typeof setTimeout> | null = null;
    let toneAnalysisEnabled = false;
    const userSpeechChunks: Buffer[] = [];
    let userSpeechBytes = 0;
    const transcript: TranscriptEntry[] = [];
    let currentAiTurnText = '';
    let currentUserTurnText = '';
    let isClosing = false;
    let isAlive = true;

    const heartbeatInterval = setInterval(() => {
      if (!isAlive) {
        clientWs.terminate();
        return;
      }
      isAlive = false;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.ping();
      }
    }, 30_000);

    clientWs.on('pong', () => {
      isAlive = true;
    });

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const flushTranscriptBuffers = () => {
      if (currentUserTurnText.trim()) {
        transcript.push({
          speaker: 'user',
          text: currentUserTurnText.trim(),
          timestamp: new Date().toISOString(),
        });
        currentUserTurnText = '';
      }
      if (currentAiTurnText.trim()) {
        transcript.push({
          speaker: 'ai',
          text: currentAiTurnText.trim(),
          timestamp: new Date().toISOString(),
        });
        currentAiTurnText = '';
      }
    };

    clientWs.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === 'start_session' || msg.type === 'start_onboarding') {
          const startCheck = wsSessionStartLimiter.check(`user:${userId}`);
          if (!startCheck.allowed) {
            sendToClient({
              type: 'error',
              message: 'Zu viele Gesprächsstarts in kurzer Zeit. Bitte warte einen Moment.',
            });
            return;
          }

          if (!hasValidApiKey()) {
            sendToClient({
              type: 'error',
              message:
                'GEMINI_API_KEY fehlt oder ist ungültig. Bitte prüfe deine lokale .env Datei und starte den Server neu.',
            });
            return;
          }

          if (geminiSession) {
            try {
              geminiSession.close();
            } catch {
              // ignore
            }
            geminiSession = null;
          }
          if (greetingTimer) {
            clearTimeout(greetingTimer);
            greetingTimer = null;
          }

          isOnboardingMode = msg.type === 'start_onboarding';
          let voiceName = 'Aoede';
          let systemInstruction = '';
          let greetingText = '';
          let statusText = '';

          if (isOnboardingMode) {
            currentSessionDbId = null;
            toneAnalysisEnabled = false;
            systemInstruction = buildOnboardingSystemPrompt(userId);
            statusText = 'Verbinde mit deinem deutschen Einrichtungs-Assistenten...';
            greetingText = `(System: Das Einrichtungs-Gespräch beginnt. Begrüße ${getLearnerProfile(userId).name} herzlich auf Deutsch, erkläre in einem kurzen Satz, dass ihr gemeinsam kurz Profil und Gesprächspartner festlegt, und stelle die erste einfache Frage.)`;
          } else {
            const fallbackPersona = getAllPersonas(userId)[0];
            if (!fallbackPersona) {
              sendToClient({
                type: 'error',
                message: 'Keine Gesprächspartner gefunden. Bitte lege zuerst eine Persona an.',
              });
              return;
            }
            currentPersonaId =
              typeof msg.personaId === 'string' && msg.personaId.trim()
                ? msg.personaId.trim()
                : fallbackPersona.id;
            currentScenarioId =
              typeof msg.scenarioId === 'string' && msg.scenarioId.trim()
                ? msg.scenarioId.trim()
                : undefined;
            const customTopic =
              typeof msg.topic === 'string' && msg.topic.trim()
                ? msg.topic.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160)
                : undefined;
            const vocabQuizWords = Array.isArray(msg.vocabQuizWords)
              ? msg.vocabQuizWords
                  .filter(
                    (w: any) =>
                      w &&
                      typeof w.simplified_hanzi === 'string' &&
                      typeof w.german === 'string'
                  )
                  .slice(0, 15)
                  .map((w: any) => ({
                    simplified_hanzi: String(w.simplified_hanzi).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40),
                    pinyin: String(w.pinyin || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80),
                    german: String(w.german).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100),
                  }))
              : undefined;
            const hasVocabQuiz = Boolean(vocabQuizWords && vocabQuizWords.length > 0);
            const persona = getPersonaById(currentPersonaId, userId) ?? fallbackPersona;
            const scenario = currentScenarioId
              ? getScenarioById(currentScenarioId, userId)
              : undefined;
            const queryText = [
              scenario?.title_de,
              scenario?.description_de,
              scenario?.target_grammar,
              customTopic,
              !scenario && !customTopic ? persona.initial_hook : undefined,
            ]
              .filter(Boolean)
              .join(' — ');
            const memoryContext = await selectSessionMemoryContext({
              apiKey: getApiKey(),
              personaId: persona.id,
              queryText,
              userId,
            });
            voiceName = persona.voice_name;
            systemInstruction = buildSystemPrompt(
              currentPersonaId,
              currentScenarioId,
              customTopic,
              userId,
              vocabQuizWords,
              memoryContext
            );
            currentSessionDbId = createSessionRecord(
              currentPersonaId,
              currentScenarioId ?? null,
              userId
            );
            sessionStartMs = Date.now();
            toneAnalysisEnabled = Boolean(msg.enableToneAnalysis);
            const openingTopicNote = customTopic
              ? `Schlage zum Einstieg locker dieses Gesprächsthema vor: "${customTopic}".`
              : 'Stelle eine einfache, natürliche Einstiegsfrage.';
            statusText = hasVocabQuiz
              ? `Starte Vokabel-Quiz mit ${persona.name_hanzi} (${vocabQuizWords!.length} Wörter)...`
              : `Verbinde mit ${persona.name_hanzi} (${liveModel})...`;
            greetingText = hasVocabQuiz
              ? `(System: Das interaktive Vokabel-Quiz beginnt! Begrüße ${getLearnerProfile(userId).name} kurz und freundlich als ${persona.name_hanzi} und starte direkt mit dem 1. Wort der Liste („${vocabQuizWords![0].german}“): Frage nach dem chinesischen Wort und einem kurzen Beispielsatz damit.)`
              : `(System: Das Gespräch hat begonnen. Begrüße ${getLearnerProfile(userId).name} herzlich auf Chinesisch in deiner Rolle als ${persona.name_hanzi}. ${openingTopicNote})`;
          }

          userSpeechChunks.length = 0;
          userSpeechBytes = 0;

          const ai = getGeminiClient();

          sendToClient({
            type: 'status',
            status: 'connecting',
            message: statusText,
          });

          geminiSession = await ai.live.connect({
            model: liveModel,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName,
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [
                {
                  functionDeclarations: isOnboardingMode
                    ? ONBOARDING_TOOLS_DECLARATIONS
                    : LIVE_TOOLS_DECLARATIONS,
                },
              ],
            },
            callbacks: {
              onopen: () => {
                sendToClient({
                  type: 'session_started',
                  sessionId: currentSessionDbId,
                  personaId: currentPersonaId,
                  voiceName,
                  isOnboarding: isOnboardingMode,
                });
              },
              onmessage: async (serverMsg: LiveServerMessage) => {
                try {
                  const serverContent = serverMsg.serverContent;
                  if (serverContent) {
                    if (serverContent.interrupted) {
                      sendToClient({ type: 'interrupted' });
                    }

                    const inputTranscription = (serverContent as any).inputTranscription;
                    if (inputTranscription?.text) {
                      currentUserTurnText += inputTranscription.text;
                      sendToClient({
                        type: 'transcript_delta',
                        speaker: 'user',
                        text: inputTranscription.text,
                        fullTurnText: currentUserTurnText,
                      });
                    }

                    const outputTranscription = (serverContent as any).outputTranscription;
                    if (outputTranscription?.text) {
                      if (currentUserTurnText.trim()) {
                        const text = currentUserTurnText.trim();
                        transcript.push({
                          speaker: 'user',
                          text,
                          timestamp: new Date().toISOString(),
                        });
                        sendToClient({
                          type: 'transcript_turn_complete',
                          speaker: 'user',
                          text,
                        });
                        currentUserTurnText = '';
                      }

                      currentAiTurnText += outputTranscription.text;
                      sendToClient({
                        type: 'transcript_delta',
                        speaker: 'ai',
                        text: outputTranscription.text,
                        fullTurnText: currentAiTurnText,
                      });
                    }

                    const parts = serverContent.modelTurn?.parts || [];
                    for (const part of parts) {
                      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
                        sendToClient({
                          type: 'audio_chunk',
                          data: part.inlineData.data,
                          mimeType: part.inlineData.mimeType,
                        });
                      }
                    }

                    if (serverContent.turnComplete) {
                      if (currentAiTurnText.trim()) {
                        const text = currentAiTurnText.trim();
                        transcript.push({
                          speaker: 'ai',
                          text,
                          timestamp: new Date().toISOString(),
                        });
                        sendToClient({
                          type: 'transcript_turn_complete',
                          speaker: 'ai',
                          text,
                        });
                        currentAiTurnText = '';
                      }
                      sendToClient({ type: 'turn_complete' });
                    }
                  }

                  const toolCall = serverMsg.toolCall;
                  if (toolCall?.functionCalls && toolCall.functionCalls.length > 0) {
                    const functionResponses: Array<{
                      id?: string;
                      name?: string;
                      response: Record<string, unknown>;
                    }> = [];

                    for (const call of toolCall.functionCalls) {
                      const args = (call.args || {}) as Record<string, any>;

                      if (call.name === 'save_vocab') {
                        const savedWord = saveOrUpdateVocabulary(
                          {
                            simplified_hanzi: String(args.simplified_hanzi || ''),
                            pinyin: String(args.pinyin || ''),
                            german: String(args.german || ''),
                            taiwan_note: args.taiwan_note ? String(args.taiwan_note) : undefined,
                            example_hanzi: args.example_hanzi
                              ? String(args.example_hanzi)
                              : undefined,
                            example_pinyin: args.example_pinyin
                              ? String(args.example_pinyin)
                              : undefined,
                            example_de: args.example_de ? String(args.example_de) : undefined,
                          },
                          userId
                        );

                        sendToClient({
                          type: 'vocab_card_popup',
                          word: savedWord,
                        });

                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: 'Vocab card saved and displayed on learner screen.' },
                        });
                      } else if (call.name === 'record_vocab_review') {
                        const outcomeRaw = String(args.outcome || 'recognized');
                        const outcome =
                          outcomeRaw === 'used_actively' || outcomeRaw === 'forgotten'
                            ? outcomeRaw
                            : 'recognized';
                        const updated = recordVocabularyReview(
                          String(args.simplified_hanzi || ''),
                          outcome,
                          userId
                        );

                        sendToClient({
                          type: 'vocab_review_recorded',
                          simplified_hanzi: args.simplified_hanzi,
                          outcome,
                          word: updated,
                        });

                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: `Recorded SRS review outcome: ${outcome}` },
                        });
                      } else if (
                        call.name === 'remember_fact' ||
                        call.name === 'save_environment_fact'
                      ) {
                        const category = String(args.category || 'general');
                        const fact = String(args.fact || '');
                        const tier = args.tier === 'core' ? 'core' : 'episodic';
                        const factId = addMemoryFact(
                          category,
                          fact,
                          isOnboardingMode ? 'onboarding' : currentPersonaId,
                          userId,
                          tier
                        );

                        sendToClient({
                          type: 'memory_saved_toast',
                          fact: { id: factId, category, fact },
                        });

                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: 'Fact saved to long-term memory.' },
                        });
                      } else if (call.name === 'update_learner_profile') {
                        const updatedProfile = updateLearnerProfile(
                          {
                            name: args.name ? String(args.name) : undefined,
                            level: args.level ? String(args.level) : undefined,
                            summary: args.summary ? String(args.summary) : undefined,
                          },
                          userId
                        );
                        sendToClient({
                          type: 'onboarding_profile_updated',
                          profile: updatedProfile,
                        });
                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: 'Learner profile updated.' },
                        });
                      } else if (call.name === 'add_or_update_person') {
                        const savedPersona = upsertPersona(
                          {
                            name_hanzi: String(args.name_hanzi || '朋友'),
                            name_pinyin: String(args.name_pinyin || 'Péngyou'),
                            relationship_de: String(args.relationship_de || 'Gesprächspartner'),
                            age_group: args.age_group ? String(args.age_group) : undefined,
                            voice_name: args.voice_name ? String(args.voice_name) : undefined,
                            avatar_emoji: args.avatar_emoji
                              ? String(args.avatar_emoji)
                              : undefined,
                            personality_prompt: args.personality_prompt
                              ? String(args.personality_prompt)
                              : undefined,
                          },
                          userId
                        );
                        sendToClient({
                          type: 'onboarding_person_saved',
                          persona: savedPersona,
                        });
                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: {
                            result: `Person ${savedPersona.name_hanzi} (${savedPersona.relationship_de}) saved.`,
                          },
                        });
                      } else if (call.name === 'finish_onboarding') {
                        updateLearnerProfile({ onboarding_completed: 1 }, userId);
                        sendToClient({
                          type: 'onboarding_completed',
                          summary_de: args.summary_de
                            ? String(args.summary_de)
                            : 'Einrichtung abgeschlossen!',
                        });
                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: 'Onboarding marked as completed.' },
                        });
                      } else {
                        functionResponses.push({
                          id: call.id,
                          name: call.name,
                          response: { result: 'ok' },
                        });
                      }
                    }

                    if (geminiSession && functionResponses.length > 0) {
                      try {
                        geminiSession.sendToolResponse({ functionResponses });
                      } catch (toolErr) {
                        console.error('Error sending tool response:', toolErr);
                      }
                    }
                  }
                } catch (msgErr) {
                  console.error('Gemini Live onmessage error:', msgErr);
                }
              },
              onerror: (err: any) => {
                console.error('Gemini Live error:', err);
                sendToClient({
                  type: 'error',
                  message: 'Verbindungsfehler zum Sprachmodell. Bitte versuche es gleich erneut.',
                });
              },
              onclose: () => {
                if (!isClosing) {
                  sendToClient({ type: 'gemini_closed' });
                }
              },
            },
          });

          if (maxSessionTimer) clearTimeout(maxSessionTimer);
          maxSessionTimer = setTimeout(() => {
            if (!isClosing && clientWs.readyState === WebSocket.OPEN) {
              sendToClient({
                type: 'error',
                message:
                  'Maximale Gesprächsdauer (75 Minuten) erreicht. Bitte starte bei Bedarf ein neues Gespräch.',
              });
              try {
                geminiSession?.close();
              } catch {
                // ignore
              }
              clientWs.close(1000, 'Max session duration reached');
            }
          }, MAX_WS_SESSION_MS);

          greetingTimer = setTimeout(() => {
            greetingTimer = null;
            if (geminiSession && !isClosing) {
              try {
                geminiSession.sendClientContent({
                  turns: [{ role: 'user', parts: [{ text: greetingText }] }],
                  turnComplete: true,
                });
              } catch (e) {
                console.error('Initial greeting trigger error:', e);
              }
            }
          }, 350);
        } else if (msg.type === 'audio_input' && geminiSession) {
          if (typeof msg.data !== 'string' || msg.data.length === 0) {
            return;
          }
          if (toneAnalysisEnabled) {
            const pcmBuf = Buffer.from(msg.data, 'base64');
            if (computePcm16Rms(pcmBuf) > 100) {
              userSpeechChunks.push(pcmBuf);
              userSpeechBytes += pcmBuf.length;
              while (userSpeechBytes > MAX_BUFFERED_PCM_BYTES && userSpeechChunks.length > 0) {
                const removed = userSpeechChunks.shift();
                if (removed) userSpeechBytes -= removed.length;
              }
            }
          }
          geminiSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text_input' && geminiSession) {
          const textCheck = wsTextInputLimiter.check(`user:${userId}`);
          if (!textCheck.allowed) {
            sendToClient({
              type: 'error',
              message: 'Zu viele Textnachrichten in kurzer Zeit. Bitte warte kurz.',
            });
            return;
          }
          const userText = String(msg.text || '').trim().slice(0, 1000);
          if (userText) {
            flushTranscriptBuffers();
            transcript.push({
              speaker: 'user',
              text: userText,
              timestamp: new Date().toISOString(),
            });
            sendToClient({
              type: 'transcript_turn_complete',
              speaker: 'user',
              text: userText,
            });
            geminiSession.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: userText }] }],
              turnComplete: true,
            });
          }
        } else if (msg.type === 'end_session') {
          isClosing = true;
          flushTranscriptBuffers();

          if (geminiSession) {
            try {
              geminiSession.close();
            } catch {
              // ignore
            }
            geminiSession = null;
          }

          if (isOnboardingMode) {
            sendToClient({ type: 'onboarding_session_ended' });
            return;
          }

          sendToClient({
            type: 'analyzing_session',
            message: 'Gespräch & Aussprache werden ausgewertet...',
          });

          const durationSeconds =
            sessionStartMs > 0 ? Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000)) : 0;
          const userAudioWavBase64 = toneAnalysisEnabled
            ? buildWavBase64FromPcm16(userSpeechChunks)
            : undefined;

          const reflection = await analyzeAndPersistSession({
            apiKey: getApiKey(),
            sessionId: currentSessionDbId || 0,
            personaId: currentPersonaId,
            scenarioId: currentScenarioId,
            transcript,
            userAudioWavBase64,
            durationSeconds,
            userId,
          });

          sendToClient({
            type: 'session_recap',
            sessionId: currentSessionDbId,
            transcript,
            reflection,
          });
        }
      } catch (err: unknown) {
        console.error('WS message handling error:', err);
        sendToClient({
          type: 'error',
          message: 'Fehler bei der Verbindung zum Sprachmodell.',
        });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      clearInterval(heartbeatInterval);
      if (greetingTimer) {
        clearTimeout(greetingTimer);
        greetingTimer = null;
      }
      if (maxSessionTimer) {
        clearTimeout(maxSessionTimer);
        maxSessionTimer = null;
      }
      const count = activeWsCountByUser.get(userId) || 1;
      if (count <= 1) {
        activeWsCountByUser.delete(userId);
      } else {
        activeWsCountByUser.set(userId, count - 1);
      }
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch {
          // ignore
        }
        geminiSession = null;
      }
    });
  });
}
