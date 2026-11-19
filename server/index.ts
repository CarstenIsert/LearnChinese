import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { analyzeAndPersistSession, TranscriptEntry } from './analyzer.ts';
import {
  addMemoryFact,
  db,
  deleteMemoryFact,
  getAllMemoryFacts,
  getAllPersonas,
  getAllScenarios,
  getAllVocabulary,
  getDueVocabulary,
  getLearnerProfile,
  getLearnerSkills,
  getPersonaById,
  getRecentFamilyEpisodesAcrossAll,
  initDatabase,
  recordVocabularyReview,
  saveOrUpdateVocabulary,
} from './db.ts';
import { buildSystemPrompt, LIVE_TOOLS_DECLARATIONS } from './prompts.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

initDatabase();

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = Number(process.env.PORT || 6889);
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

function getApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function hasValidApiKey(): boolean {
  const key = getApiKey();
  return Boolean(key && key !== 'your_gemini_api_key_here');
}

// --- REST API Endpoints ---

app.get('/api/status', (_req, res) => {
  res.json({
    hasApiKey: hasValidApiKey(),
    liveModel: LIVE_MODEL,
  });
});

app.get('/api/bootstrap', (_req, res) => {
  const profile = getLearnerProfile();
  const personas = getAllPersonas();
  const scenarios = getAllScenarios();
  const memoryFacts = getAllMemoryFacts();
  const recentEpisodes = getRecentFamilyEpisodesAcrossAll(8);
  const skills = getLearnerSkills();
  const dueVocabulary = getDueVocabulary(8);
  const allVocabulary = getAllVocabulary();
  const recentSessions = db
    .prepare(`
      SELECT s.id, s.persona_id, s.scenario_id, s.started_at, s.ended_at, s.summary_de,
             p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji
      FROM sessions s
      JOIN personas p ON p.id = s.persona_id
      WHERE s.ended_at IS NOT NULL
      ORDER BY s.id DESC LIMIT 10
    `)
    .all();

  res.json({
    hasApiKey: hasValidApiKey(),
    liveModel: LIVE_MODEL,
    profile,
    personas,
    scenarios,
    memoryFacts,
    recentEpisodes,
    skills,
    dueVocabulary,
    allVocabulary,
    recentSessions,
  });
});

app.post('/api/memories', (req, res) => {
  const { category, fact } = req.body as { category?: string; fact?: string };
  if (!fact || !fact.trim()) {
    res.status(400).json({ error: 'Fact is required' });
    return;
  }
  const id = addMemoryFact(category || 'general', fact.trim(), 'manual-user');
  res.json({ id, facts: getAllMemoryFacts() });
});

app.delete('/api/memories/:id', (req, res) => {
  const id = Number(req.params.id);
  deleteMemoryFact(id);
  res.json({ ok: true, facts: getAllMemoryFacts() });
});

app.post('/api/vocabulary', (req, res) => {
  const { simplified_hanzi, pinyin, german, taiwan_note, example_hanzi, example_pinyin, example_de } =
    req.body;
  if (!simplified_hanzi || !pinyin || !german) {
    res.status(400).json({ error: 'Hanzi, Pinyin, and German are required' });
    return;
  }
  const saved = saveOrUpdateVocabulary({
    simplified_hanzi,
    pinyin,
    german,
    taiwan_note,
    example_hanzi,
    example_pinyin,
    example_de,
  });
  res.json({ word: saved, allVocabulary: getAllVocabulary(), dueVocabulary: getDueVocabulary(8) });
});

app.post('/api/vocabulary/review', (req, res) => {
  const { simplified_hanzi, outcome } = req.body as {
    simplified_hanzi: string;
    outcome: 'used_actively' | 'recognized' | 'forgotten';
  };
  const updated = recordVocabularyReview(simplified_hanzi, outcome);
  res.json({
    word: updated,
    allVocabulary: getAllVocabulary(),
    dueVocabulary: getDueVocabulary(8),
  });
});

// Serve static build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = http.createServer(app);

// --- WebSocket Server for Gemini Multimodal Live API ---

const wss = new WebSocketServer({ server, path: '/ws/live' });

wss.on('connection', (clientWs: WebSocket) => {
  let geminiSession: any = null;
  let currentSessionDbId: number | null = null;
  let currentPersonaId = 'coach-lin';
  let currentScenarioId: string | undefined = undefined;
  const transcript: TranscriptEntry[] = [];
  let currentAiTurnText = '';
  let currentUserTurnText = '';
  let isClosing = false;

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

      // 1. Start a new Gemini Live voice session
      if (msg.type === 'start_session') {
        if (!hasValidApiKey()) {
          sendToClient({
            type: 'error',
            message:
              'GEMINI_API_KEY fehlt oder ist ungültig. Bitte prüfe deine lokale .env Datei und starte den Server neu.',
          });
          return;
        }

        const fallbackPersona = getAllPersonas()[0];
        currentPersonaId = msg.personaId || fallbackPersona.id;
        currentScenarioId = msg.scenarioId || undefined;
        const customTopic = msg.topic ? String(msg.topic) : undefined;
        const persona = getPersonaById(currentPersonaId) ?? fallbackPersona;
        const systemInstruction = buildSystemPrompt(currentPersonaId, currentScenarioId, customTopic);

        // Create session row in SQLite
        const info = db
          .prepare('INSERT INTO sessions (persona_id, scenario_id) VALUES (?, ?)')
          .run(currentPersonaId, currentScenarioId ?? null);
        currentSessionDbId = Number(info.lastInsertRowid);

        const ai = new GoogleGenAI({ apiKey: getApiKey() });

        sendToClient({
          type: 'status',
          status: 'connecting',
          message: `Verbinde mit ${persona.name_hanzi} (${LIVE_MODEL})...`,
        });

        geminiSession = await ai.live.connect({
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: persona.voice_name,
                },
              },
            },
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: LIVE_TOOLS_DECLARATIONS }],
          },
          callbacks: {
            onopen: () => {
              sendToClient({
                type: 'session_started',
                sessionId: currentSessionDbId,
                personaId: currentPersonaId,
                voiceName: persona.voice_name,
              });
            },
            onmessage: async (serverMsg: LiveServerMessage) => {
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

              // Handle Live Tool Calls
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
                    const savedWord = saveOrUpdateVocabulary({
                      simplified_hanzi: String(args.simplified_hanzi || ''),
                      pinyin: String(args.pinyin || ''),
                      german: String(args.german || ''),
                      taiwan_note: args.taiwan_note ? String(args.taiwan_note) : undefined,
                      example_hanzi: args.example_hanzi ? String(args.example_hanzi) : undefined,
                      example_pinyin: args.example_pinyin ? String(args.example_pinyin) : undefined,
                      example_de: args.example_de ? String(args.example_de) : undefined,
                    });

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
                      outcome
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
                  } else if (call.name === 'remember_fact') {
                    const category = String(args.category || 'general');
                    const fact = String(args.fact || '');
                    const factId = addMemoryFact(category, fact, currentPersonaId);

                    sendToClient({
                      type: 'memory_saved_toast',
                      fact: { id: factId, category, fact },
                    });

                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: 'Fact saved to long-term memory.' },
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
            },
            onerror: (err: any) => {
              console.error('Gemini Live error:', err);
              sendToClient({
                type: 'error',
                message: `Verbindungsfehler zum Sprachmodell: ${err?.message || 'Bitte API Key und Netzwerk prüfen.'}`,
              });
            },
            onclose: () => {
              if (!isClosing) {
                sendToClient({ type: 'gemini_closed' });
              }
            },
          },
        });

        const openingTopicNote = customTopic
          ? `Schlage zum Einstieg locker dieses Gesprächsthema vor: "${customTopic}".`
          : 'Stelle eine einfache, natürliche Einstiegsfrage.';

        setTimeout(() => {
          if (geminiSession) {
            try {
              geminiSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `(System: Das Gespräch hat begonnen. Begrüße ${getLearnerProfile().name} herzlich auf Chinesisch in deiner Rolle als ${persona.name_hanzi}. ${openingTopicNote})`,
                      },
                    ],
                  },
                ],
                turnComplete: true,
              });
            } catch (e) {
              console.error('Initial greeting trigger error:', e);
            }
          }
        }, 350);
      }

      // 2. Stream PCM 16kHz microphone audio chunk
      else if (msg.type === 'audio_input' && geminiSession) {
        geminiSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      }

      // 3. Send a quick text/hint request during the call
      else if (msg.type === 'text_input' && geminiSession) {
        const userText = String(msg.text || '').trim();
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
      }

      // 4. End the session & run the Post-Session Reflection Pipeline
      else if (msg.type === 'end_session') {
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

        sendToClient({
          type: 'analyzing_session',
          message: 'Gespräch wird ausgewertet & Erinnerungen werden gespeichert...',
        });

        const reflection = await analyzeAndPersistSession({
          apiKey: getApiKey(),
          sessionId: currentSessionDbId || 0,
          personaId: currentPersonaId,
          scenarioId: currentScenarioId,
          transcript,
        });

        sendToClient({
          type: 'session_recap',
          sessionId: currentSessionDbId,
          transcript,
          reflection,
        });
      }
    } catch (err: any) {
      console.error('WS message handling error:', err);
      sendToClient({
        type: 'error',
        message: err?.message || 'Fehler bei der Verbindung zum Sprachmodell.',
      });
    }
  });

  clientWs.on('close', () => {
    isClosing = true;
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

server.listen(PORT, () => {
  console.log(`Learn Chinese server running on http://localhost:${PORT} (Model: ${LIVE_MODEL})`);
});
