import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { analyzeAndPersistSession, TranscriptEntry } from './analyzer.ts';
import {
  expandCurriculumNext,
  HSK_CURRICULUM_PROGRESSION,
  maybeAutoExpandCurriculum,
  suggestCurrentTopic,
} from './curriculum.ts';
import {
  addMemoryFact,
  createSessionRecord,
  DEFAULT_USER_ID,
  deleteMemoryFact,
  deletePersona,
  getAllMemoryFacts,
  getAllPersonas,
  getAllScenarios,
  getAllVocabulary,
  getDueVocabulary,
  getLearnerProfile,
  getLearnerSkills,
  getLearningStats,
  getPersonaById,
  getRecentFamilyEpisodesAcrossAll,
  getRecentSessions,
  initDatabase,
  recordVocabularyReview,
  saveOrUpdateVocabulary,
  updateLearnerProfile,
  updateSentenceComplexityPreference,
  upsertPersona,
} from './db.ts';
import {
  AuthUser,
  createAuthRouter,
  getAuthenticatedUserFromRequest,
  isAuthEnforced,
  requireAuth,
} from './auth.ts';
import {
  buildOnboardingSystemPrompt,
  buildSystemPrompt,
  LIVE_TOOLS_DECLARATIONS,
  ONBOARDING_TOOLS_DECLARATIONS,
} from './prompts.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

initDatabase();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '5mb' }));

const PORT = Number(process.env.PORT || 6889);
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const TTS_CACHE_DIR = path.resolve(process.cwd(), 'data', 'tts-cache');
if (!fs.existsSync(TTS_CACHE_DIR)) {
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
}

async function synthesizeMandarinWithLive(
  ai: GoogleGenAI,
  text: string,
  voiceName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let session: any = null;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          session?.close();
        } catch {
          // ignore
        }
        reject(new Error('TTS generation timed out'));
      }
    }, 12000);

    ai.live
      .connect({
        model: LIVE_MODEL,
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
            parts: [
              {
                text: 'You are a Mandarin pronunciation dictionary. When given a Chinese word or sentence, ONLY read that exact Chinese text aloud once clearly in standard Mandarin at a calm learner pace. Do not add any extra words or commentary.',
              },
            ],
          },
        },
        callbacks: {
          onmessage: (msg: LiveServerMessage) => {
            const parts = msg.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
                chunks.push(Buffer.from(part.inlineData.data, 'base64'));
              }
            }
            if (msg.serverContent?.turnComplete && !settled) {
              settled = true;
              clearTimeout(timer);
              try {
                session?.close();
              } catch {
                // ignore
              }
              if (chunks.length === 0) {
                reject(new Error('No audio returned from Gemini Live TTS'));
              } else {
                resolve(Buffer.concat(chunks));
              }
            }
          },
          onerror: (err: any) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(err instanceof Error ? err : new Error(String(err?.message || err)));
            }
          },
          onclose: () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              if (chunks.length > 0) {
                resolve(Buffer.concat(chunks));
              } else {
                reject(new Error('Gemini Live TTS connection closed before audio completed'));
              }
            }
          },
        },
      })
      .then((s) => {
        session = s;
        if (!settled) {
          s.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          });
        } else {
          try {
            s.close();
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

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

app.use('/api/auth', createAuthRouter());
app.use('/api', requireAuth);

app.get('/api/bootstrap', async (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  await maybeAutoExpandCurriculum(undefined, userId).catch(() => null);
  const profile = getLearnerProfile(userId);
  const personas = getAllPersonas(userId);
  const scenarios = getAllScenarios(userId);
  const existingIds = new Set(scenarios.map((s) => s.id));
  const remainingCurated = HSK_CURRICULUM_PROGRESSION.filter((c) => !existingIds.has(c.id)).length;
  const memoryFacts = getAllMemoryFacts(userId);
  const recentEpisodes = getRecentFamilyEpisodesAcrossAll(8, userId);
  const skills = getLearnerSkills(userId);
  const dueVocabulary = getDueVocabulary(8, userId);
  const allVocabulary = getAllVocabulary(userId);
  const recentSessions = getRecentSessions(userId, 10);

  const stats = getLearningStats(userId);

  res.json({
    hasApiKey: hasValidApiKey(),
    liveModel: LIVE_MODEL,
    profile,
    stats,
    personas,
    scenarios,
    curriculumMeta: { remainingCurated },
    memoryFacts,
    recentEpisodes,
    skills,
    dueVocabulary,
    allVocabulary,
    recentSessions,
  });
});

app.post('/api/profile/complexity', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { preference } = req.body as { preference?: string };
  const valid =
    preference === 'short' ||
    preference === 'medium' ||
    preference === 'natural' ||
    preference === 'auto';
  if (!valid) {
    res.status(400).json({ error: 'Invalid complexity preference' });
    return;
  }
  updateSentenceComplexityPreference(preference, userId);
  res.json({ ok: true, stats: getLearningStats(userId), profile: getLearnerProfile(userId) });
});

app.post('/api/topics/suggest', async (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { personaId, recentTopics } = (req.body || {}) as {
    personaId?: string;
    recentTopics?: string[];
  };
  const result = await suggestCurrentTopic({
    apiKey: getApiKey(),
    personaId,
    recentTopics: Array.isArray(recentTopics) ? recentTopics.slice(0, 10) : [],
    userId,
  });
  res.json(result);
});

app.post('/api/curriculum/expand', async (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { targetLevel } = (req.body || {}) as { targetLevel?: 'HSK 3' | 'HSK 4' };
  const validLevel = targetLevel === 'HSK 3' || targetLevel === 'HSK 4' ? targetLevel : undefined;
  const result = await expandCurriculumNext({
    apiKey: getApiKey(),
    targetLevel: validLevel,
    userId,
  });
  res.json({
    ...result,
    scenarios: getAllScenarios(userId),
  });
});

app.get('/api/tts', async (req, res) => {
  const rawText = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  if (!rawText || rawText.length > 200) {
    res.status(400).json({ error: 'Text must be between 1 and 200 characters' });
    return;
  }

  const voiceName = 'Kore';
  const cacheKey = crypto.createHash('sha256').update(`v2:${voiceName}:${rawText}`).digest('hex');
  const cacheFile = path.join(TTS_CACHE_DIR, `${cacheKey}.wav`);

  if (fs.existsSync(cacheFile)) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(cacheFile);
    return;
  }

  if (!hasValidApiKey()) {
    res.status(503).json({ error: 'GEMINI_API_KEY missing or invalid' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const pcmBuffer = await synthesizeMandarinWithLive(ai, rawText, voiceName);
    // Pad with 100ms leading and 350ms trailing silence (24kHz 16-bit mono) so browser audio never clips short words
    const leadSilence = Buffer.alloc(4800);
    const trailSilence = Buffer.alloc(16800);
    const paddedPcm = Buffer.concat([leadSilence, pcmBuffer, trailSilence]);
    const wavBuffer = wrapPcm16AsWav(paddedPcm, 24000);
    fs.writeFileSync(cacheFile, wavBuffer);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(wavBuffer);
  } catch (err: any) {
    console.error('Gemini TTS error:', err);
    res.status(500).json({ error: err?.message || 'TTS generation failed' });
  }
});

app.post('/api/vocabulary/check-pronunciation', async (req, res) => {
  const { targetHanzi, targetPinyin, targetGerman, audioBase64, mimeType } = req.body as {
    targetHanzi?: string;
    targetPinyin?: string;
    targetGerman?: string;
    audioBase64?: string;
    mimeType?: string;
  };

  if (!targetHanzi || !audioBase64 || !mimeType) {
    res.status(400).json({ error: 'targetHanzi, audioBase64, and mimeType are required' });
    return;
  }

  if (!hasValidApiKey()) {
    res.status(503).json({ error: 'GEMINI_API_KEY missing or invalid' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const prompt = `You are a strict yet encouraging Mandarin Chinese pronunciation and tone coach for a German-speaking learner.
The learner tried to pronounce the target Mandarin word/phrase:
- Target Hanzi: ${targetHanzi}
- Target Pinyin: ${targetPinyin || '(unknown)'}
- German meaning: ${targetGerman || ''}

Listen carefully to the attached audio recording. Evaluate:
1. Did they say the right syllables/word?
2. Are the Mandarin tones (声调: 1st flat, 2nd rising, 3rd dipping, 4th falling, neutral) accurate?

Return structured JSON with:
- passed (boolean): true if the word is clearly recognizable and the tones are mostly accurate; false if the wrong word was said or a tone is clearly off.
- heard_text (string): what you heard in Simplified Chinese / Pinyin (or "(nichts verstanden)" if silent/unclear).
- tone_accuracy_de (string): concise assessment of each syllable's tone in German (e.g. "1. Silbe (2. Ton) gut steigend, 2. Silbe (4. Ton) etwas zu flach").
- tip_de (string): 1–2 encouraging sentences in German on how to improve or confirming it sounded great.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          inlineData: {
            mimeType,
            data: audioBase64,
          },
        },
        { text: prompt },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            passed: { type: Type.BOOLEAN },
            heard_text: { type: Type.STRING },
            tone_accuracy_de: { type: Type.STRING },
            tip_de: { type: Type.STRING },
          },
          required: ['passed', 'heard_text', 'tone_accuracy_de', 'tip_de'],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    res.json(result);
  } catch (err: any) {
    console.error('Pronunciation check error:', err);
    res.status(500).json({ error: err?.message || 'Pronunciation check failed' });
  }
});

app.post('/api/memories', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { category, fact } = req.body as { category?: string; fact?: string };
  if (!fact || !fact.trim()) {
    res.status(400).json({ error: 'Fact is required' });
    return;
  }
  const id = addMemoryFact(category || 'general', fact.trim(), 'manual-user', userId);
  res.json({ id, facts: getAllMemoryFacts(userId) });
});

app.post('/api/profile/onboarding', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { name, level, summary, onboarding_completed } = (req.body || {}) as {
    name?: string;
    level?: string;
    summary?: string;
    onboarding_completed?: boolean | number;
  };
  const updated = updateLearnerProfile(
    {
      name,
      level,
      summary,
      onboarding_completed:
        onboarding_completed !== undefined ? (onboarding_completed ? 1 : 0) : undefined,
    },
    userId
  );
  res.json({ profile: updated });
});

function buildPersonaInput(body: Record<string, any>, idOverride?: string) {
  return {
    id: idOverride ?? (body.id ? String(body.id) : undefined),
    name_hanzi: String(body.name_hanzi),
    name_pinyin: String(body.name_pinyin || body.name_hanzi),
    relationship_de: String(body.relationship_de),
    generation: body.generation ? String(body.generation) : undefined,
    age_group: body.age_group ? String(body.age_group) : undefined,
    voice_name: body.voice_name ? String(body.voice_name) : undefined,
    avatar_emoji: body.avatar_emoji ? String(body.avatar_emoji) : undefined,
    personality_prompt: body.personality_prompt ? String(body.personality_prompt) : undefined,
    speaking_style: body.speaking_style ? String(body.speaking_style) : undefined,
    initial_hook: body.initial_hook ? String(body.initial_hook) : undefined,
  };
}

app.post('/api/personas', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const body = (req.body || {}) as Record<string, any>;
  if (!body.name_hanzi?.trim() || !body.relationship_de?.trim()) {
    res.status(400).json({ error: 'Chinesischer Name und Beziehung auf Deutsch sind erforderlich.' });
    return;
  }
  const persona = upsertPersona(buildPersonaInput(body), userId);
  res.json({ persona, personas: getAllPersonas(userId) });
});

app.put('/api/personas/:id', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const id = String(req.params.id || '').trim();
  const body = (req.body || {}) as Record<string, any>;
  if (!id || !body.name_hanzi?.trim() || !body.relationship_de?.trim()) {
    res.status(400).json({ error: 'ID, chinesischer Name und Beziehung sind erforderlich.' });
    return;
  }
  if (!getPersonaById(id, userId)) {
    res.status(404).json({ error: 'Person nicht gefunden.' });
    return;
  }
  const persona = upsertPersona(buildPersonaInput(body, id), userId);
  res.json({ persona, personas: getAllPersonas(userId) });
});

app.delete('/api/personas/:id', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const id = String(req.params.id || '').trim();
  const result = deletePersona(id, userId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, personas: getAllPersonas(userId) });
});

app.delete('/api/memories/:id', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid memory ID' });
    return;
  }
  deleteMemoryFact(id, userId);
  res.json({ ok: true, facts: getAllMemoryFacts(userId) });
});

app.post('/api/vocabulary', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { simplified_hanzi, pinyin, german, taiwan_note, example_hanzi, example_pinyin, example_de } =
    req.body;
  if (!simplified_hanzi || !pinyin || !german) {
    res.status(400).json({ error: 'Hanzi, Pinyin, and German are required' });
    return;
  }
  const saved = saveOrUpdateVocabulary(
    {
      simplified_hanzi,
      pinyin,
      german,
      taiwan_note,
      example_hanzi,
      example_pinyin,
      example_de,
    },
    userId
  );
  res.json({
    word: saved,
    allVocabulary: getAllVocabulary(userId),
    dueVocabulary: getDueVocabulary(8, userId),
  });
});

app.post('/api/vocabulary/review', (req, res) => {
  const userId = req.user?.id ?? DEFAULT_USER_ID;
  const { simplified_hanzi, outcome } = req.body as {
    simplified_hanzi: string;
    outcome: 'used_actively' | 'recognized' | 'forgotten';
  };
  const updated = recordVocabularyReview(simplified_hanzi, outcome, userId);
  res.json({
    word: updated,
    allVocabulary: getAllVocabulary(userId),
    dueVocabulary: getDueVocabulary(8, userId),
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

// --- Audio Helper for Post-Session Tone Analysis ---
const MAX_BUFFERED_PCM_BYTES = 4_800_000; // ~150s of 16kHz 16-bit mono speech

function computePcm16Rms(pcmBuffer: Buffer): number {
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

function wrapPcm16AsWav(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

function buildWavBase64FromPcm16(chunks: Buffer[], sampleRate = 16000): string | undefined {
  if (chunks.length === 0) return undefined;
  const pcmData = Buffer.concat(chunks);
  if (pcmData.length < sampleRate * 2 * 0.6) {
    // Less than ~0.6s of speech is too short for reliable tone analysis
    return undefined;
  }
  return wrapPcm16AsWav(pcmData, sampleRate).toString('base64');
}

// --- WebSocket Server for Gemini Multimodal Live API ---

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

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
  let geminiSession: any = null;
  let currentSessionDbId: number | null = null;
  let currentPersonaId = 'coach-lin';
  let currentScenarioId: string | undefined = undefined;
  let isOnboardingMode = false;
  let sessionStartMs = 0;
  let toneAnalysisEnabled = false;
  const userSpeechChunks: Buffer[] = [];
  let userSpeechBytes = 0;
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

      // 1. Start a new Gemini Live voice session (regular Chinese practice OR German onboarding)
      if (msg.type === 'start_session' || msg.type === 'start_onboarding') {
        if (!hasValidApiKey()) {
          sendToClient({
            type: 'error',
            message:
              'GEMINI_API_KEY fehlt oder ist ungültig. Bitte prüfe deine lokale .env Datei und starte den Server neu.',
          });
          return;
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
          currentPersonaId = msg.personaId || fallbackPersona.id;
          currentScenarioId = msg.scenarioId || undefined;
          const customTopic = msg.topic ? String(msg.topic) : undefined;
          const persona = getPersonaById(currentPersonaId, userId) ?? fallbackPersona;
          voiceName = persona.voice_name;
          systemInstruction = buildSystemPrompt(
            currentPersonaId,
            currentScenarioId,
            customTopic,
            userId
          );
          currentSessionDbId = createSessionRecord(currentPersonaId, currentScenarioId ?? null, userId);
          sessionStartMs = Date.now();
          toneAnalysisEnabled = Boolean(msg.enableToneAnalysis);
          const openingTopicNote = customTopic
            ? `Schlage zum Einstieg locker dieses Gesprächsthema vor: "${customTopic}".`
            : 'Stelle eine einfache, natürliche Einstiegsfrage.';
          statusText = `Verbinde mit ${persona.name_hanzi} (${LIVE_MODEL})...`;
          greetingText = `(System: Das Gespräch hat begonnen. Begrüße ${getLearnerProfile(userId).name} herzlich auf Chinesisch in deiner Rolle als ${persona.name_hanzi}. ${openingTopicNote})`;
        }

        userSpeechChunks.length = 0;
        userSpeechBytes = 0;

        const ai = new GoogleGenAI({ apiKey: getApiKey() });

        sendToClient({
          type: 'status',
          status: 'connecting',
          message: statusText,
        });

        geminiSession = await ai.live.connect({
          model: LIVE_MODEL,
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
                    const savedWord = saveOrUpdateVocabulary(
                      {
                        simplified_hanzi: String(args.simplified_hanzi || ''),
                        pinyin: String(args.pinyin || ''),
                        german: String(args.german || ''),
                        taiwan_note: args.taiwan_note ? String(args.taiwan_note) : undefined,
                        example_hanzi: args.example_hanzi ? String(args.example_hanzi) : undefined,
                        example_pinyin: args.example_pinyin ? String(args.example_pinyin) : undefined,
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
                  } else if (call.name === 'remember_fact' || call.name === 'save_environment_fact') {
                    const category = String(args.category || 'general');
                    const fact = String(args.fact || '');
                    const factId = addMemoryFact(
                      category,
                      fact,
                      isOnboardingMode ? 'onboarding' : currentPersonaId,
                      userId
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
                        avatar_emoji: args.avatar_emoji ? String(args.avatar_emoji) : undefined,
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

        setTimeout(() => {
          if (geminiSession) {
            try {
              geminiSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: greetingText }],
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
        if (toneAnalysisEnabled && typeof msg.data === 'string' && msg.data.length > 0) {
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
