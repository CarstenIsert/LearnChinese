import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  GENERIC_CURRICULUM_SCENARIOS,
  GENERIC_PERSONAS,
  GENERIC_SEED_PROFILE,
  INITIAL_DEFAULT_SKILLS,
  INITIAL_DEFAULT_VOCAB,
  SeedProfileData,
} from './seed.example.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tutor.db');
const LOCAL_PROFILE_PATH = path.join(DATA_DIR, 'profile.local.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function loadLocalOrGenericSeed(): SeedProfileData {
  if (fs.existsSync(LOCAL_PROFILE_PATH)) {
    try {
      const raw = fs.readFileSync(LOCAL_PROFILE_PATH, 'utf-8');
      return JSON.parse(raw) as SeedProfileData;
    } catch (err) {
      console.warn('Could not parse data/profile.local.json, falling back to generic seed:', err);
    }
  }
  return GENERIC_SEED_PROFILE;
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learner_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      native_language TEXT NOT NULL,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name_hanzi TEXT NOT NULL,
      name_pinyin TEXT NOT NULL,
      relationship_de TEXT NOT NULL,
      generation TEXT NOT NULL,
      age_group TEXT NOT NULL,
      voice_name TEXT NOT NULL,
      avatar_emoji TEXT NOT NULL,
      personality_prompt TEXT NOT NULL,
      speaking_style TEXT NOT NULL,
      initial_hook TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      fact TEXT NOT NULL,
      source_persona_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS persona_episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id TEXT NOT NULL,
      session_id INTEGER,
      summary TEXT NOT NULL,
      next_hook TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (persona_id) REFERENCES personas(id)
    );

    CREATE TABLE IF NOT EXISTS learner_skill_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'practicing', -- 'struggling' | 'practicing' | 'comfortable'
      notes_de TEXT NOT NULL,
      last_example TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simplified_hanzi TEXT NOT NULL UNIQUE,
      pinyin TEXT NOT NULL,
      german TEXT NOT NULL,
      taiwan_note TEXT,
      example_hanzi TEXT,
      example_pinyin TEXT,
      example_de TEXT,
      stability REAL NOT NULL DEFAULT 1.0,
      streak INTEGER NOT NULL DEFAULT 0,
      times_recognized INTEGER NOT NULL DEFAULT 0,
      times_used_actively INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS curriculum_scenarios (
      id TEXT PRIMARY KEY,
      stage_number INTEGER NOT NULL,
      stage_title_de TEXT NOT NULL,
      title_de TEXT NOT NULL,
      title_hanzi TEXT NOT NULL,
      description_de TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      target_grammar TEXT NOT NULL,
      suggested_vocab TEXT NOT NULL,
      hsk_level TEXT NOT NULL DEFAULT 'HSK 3',
      mastery_score INTEGER NOT NULL DEFAULT 0,
      times_practiced INTEGER NOT NULL DEFAULT 0,
      last_practiced_at TEXT,
      FOREIGN KEY (persona_id) REFERENCES personas(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id TEXT NOT NULL,
      scenario_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      transcript_json TEXT NOT NULL DEFAULT '[]',
      summary_de TEXT,
      coaching_notes_json TEXT,
      extracted_memories_json TEXT,
      FOREIGN KEY (persona_id) REFERENCES personas(id)
    );
  `);

  // Safe schema migrations for existing databases
  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === 'duration_seconds')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0`);
  }

  const profileCols = db
    .prepare(`PRAGMA table_info(learner_profile)`)
    .all() as Array<{ name: string }>;
  if (!profileCols.some((c) => c.name === 'sentence_complexity')) {
    db.exec(
      `ALTER TABLE learner_profile ADD COLUMN sentence_complexity TEXT NOT NULL DEFAULT 'auto'`
    );
  }

  const scenarioCols = db
    .prepare(`PRAGMA table_info(curriculum_scenarios)`)
    .all() as Array<{ name: string }>;
  if (!scenarioCols.some((c) => c.name === 'hsk_level')) {
    db.exec(
      `ALTER TABLE curriculum_scenarios ADD COLUMN hsk_level TEXT NOT NULL DEFAULT 'HSK 3'`
    );
  }

  const seedData = loadLocalOrGenericSeed();
  const personasToSeed =
    seedData.personas && seedData.personas.length > 0 ? seedData.personas : GENERIC_PERSONAS;
  const scenariosToSeed =
    seedData.scenarios && seedData.scenarios.length > 0
      ? seedData.scenarios
      : GENERIC_CURRICULUM_SCENARIOS;
  const skillsToSeed =
    seedData.initialSkills && seedData.initialSkills.length > 0
      ? seedData.initialSkills
      : INITIAL_DEFAULT_SKILLS;

  // Seed personas
  const insertPersona = db.prepare(`
    INSERT OR REPLACE INTO personas (
      id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
      voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
    ) VALUES (
      @id, @name_hanzi, @name_pinyin, @relationship_de, @generation, @age_group,
      @voice_name, @avatar_emoji, @personality_prompt, @speaking_style, @initial_hook
    )
  `);
  for (const p of personasToSeed) {
    insertPersona.run(p);
  }

  // Seed curriculum scenarios (only insert if missing so mastery_score is preserved)
  const insertScenario = db.prepare(`
    INSERT OR IGNORE INTO curriculum_scenarios (
      id, stage_number, stage_title_de, title_de, title_hanzi,
      description_de, persona_id, target_grammar, suggested_vocab
    ) VALUES (
      @id, @stage_number, @stage_title_de, @title_de, @title_hanzi,
      @description_de, @persona_id, @target_grammar, @suggested_vocab
    )
  `);
  for (const s of scenariosToSeed) {
    insertScenario.run(s);
  }

  // Seed initial vocabulary if table is empty
  const vocabCount = (db.prepare('SELECT COUNT(*) as c FROM vocabulary').get() as { c: number }).c;
  if (vocabCount === 0) {
    const insertVocab = db.prepare(`
      INSERT OR IGNORE INTO vocabulary (
        simplified_hanzi, pinyin, german, taiwan_note,
        example_hanzi, example_pinyin, example_de, next_review_at
      ) VALUES (
        @simplified_hanzi, @pinyin, @german, @taiwan_note,
        @example_hanzi, @example_pinyin, @example_de, datetime('now')
      )
    `);
    for (const v of INITIAL_DEFAULT_VOCAB) {
      insertVocab.run(v);
    }
  }

  // Seed initial skill memory if empty
  const skillCount = (db.prepare('SELECT COUNT(*) as c FROM learner_skill_memory').get() as { c: number }).c;
  if (skillCount === 0) {
    const insertSkill = db.prepare(`
      INSERT INTO learner_skill_memory (skill_name, category, status, notes_de, last_example)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const sk of skillsToSeed) {
      insertSkill.run(sk.skill_name, sk.category, sk.status, sk.notes_de, sk.last_example);
    }
  }

  // Seed learner profile & initial memory facts from local git-ignored `data/profile.local.json`
  // or fall back to GENERIC_SEED_PROFILE if cloning from public GitHub repo
  const existingProfile = db.prepare('SELECT id FROM learner_profile WHERE id = 1').get();
  if (!existingProfile) {
    db.prepare(`
      INSERT INTO learner_profile (id, name, level, native_language, summary)
      VALUES (1, ?, ?, ?, ?)
    `).run(
      seedData.learnerProfile.name,
      seedData.learnerProfile.level,
      seedData.learnerProfile.nativeLanguage,
      seedData.learnerProfile.summary
    );

    const insertFact = db.prepare(`
      INSERT INTO memory_facts (category, fact, source_persona_id)
      VALUES (?, ?, 'system-init')
    `);
    for (const f of seedData.memoryFacts) {
      insertFact.run(f.category, f.fact);
    }
  }
}

// Helper queries for the Memory Engine & API
export function getLearnerProfile() {
  return db.prepare('SELECT * FROM learner_profile WHERE id = 1').get() as {
    id: number;
    name: string;
    level: string;
    native_language: string;
    summary: string;
    sentence_complexity?: 'auto' | 'short' | 'medium' | 'natural';
  };
}

export function updateSentenceComplexityPreference(
  preference: 'auto' | 'short' | 'medium' | 'natural'
) {
  db.prepare(`UPDATE learner_profile SET sentence_complexity = ?, updated_at = datetime('now') WHERE id = 1`).run(
    preference
  );
}

export function getLearningStats() {
  const durationExpr = `CASE WHEN duration_seconds > 0 THEN duration_seconds WHEN ended_at IS NOT NULL THEN MAX(0, CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) ELSE 0 END`;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as totalSessions, COALESCE(SUM(${durationExpr}), 0) as totalSeconds FROM sessions WHERE ended_at IS NOT NULL`
    )
    .get() as { totalSessions: number; totalSeconds: number };

  const todayRow = db
    .prepare(
      `SELECT COALESCE(SUM(${durationExpr}), 0) as todaySeconds FROM sessions WHERE ended_at IS NOT NULL AND date(started_at, 'localtime') = date('now', 'localtime')`
    )
    .get() as { todaySeconds: number };

  const weekRow = db
    .prepare(
      `SELECT COALESCE(SUM(${durationExpr}), 0) as weekSeconds FROM sessions WHERE ended_at IS NOT NULL AND datetime(started_at) >= datetime('now', '-7 days')`
    )
    .get() as { weekSeconds: number };

  const vocabStats = db
    .prepare(
      `SELECT
         COUNT(*) as totalVocabulary,
         SUM(CASE WHEN date(created_at, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END) as newWordsToday,
         SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as newWordsLast7Days,
         SUM(CASE WHEN streak >= 2 OR times_used_actively >= 1 THEN 1 ELSE 0 END) as masteredWords,
         SUM(CASE WHEN datetime(next_review_at) <= datetime('now', '+2 hours') THEN 1 ELSE 0 END) as dueWords
       FROM vocabulary`
    )
    .get() as {
    totalVocabulary: number;
    newWordsToday: number;
    newWordsLast7Days: number;
    masteredWords: number;
    dueWords: number;
  };

  // Compute consecutive learning day streak (UTC/localtime dates)
  const sessionDays = db
    .prepare(
      `SELECT DISTINCT date(started_at, 'localtime') as day FROM sessions WHERE ended_at IS NOT NULL ORDER BY day DESC`
    )
    .all() as Array<{ day: string }>;

  let streakDays = 0;
  if (sessionDays.length > 0) {
    const todayStr = (
      db.prepare(`SELECT date('now', 'localtime') as d`).get() as { d: string }
    ).d;
    const yesterdayStr = (
      db.prepare(`SELECT date('now', 'localtime', '-1 day') as d`).get() as { d: string }
    ).d;

    if (sessionDays[0].day === todayStr || sessionDays[0].day === yesterdayStr) {
      let expectedDate = new Date(`${sessionDays[0].day}T00:00:00`);
      for (const row of sessionDays) {
        const rowStr = row.day;
        const expectedStr = expectedDate.toISOString().slice(0, 10);
        if (rowStr === expectedStr) {
          streakDays += 1;
          expectedDate.setDate(expectedDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }

  const totalSessions = totalRow.totalSessions || 0;
  const masteredWords = vocabStats.masteredWords || 0;

  let progressionTier: 1 | 2 | 3 = 1;
  let progressionLabelDe = 'Stufe 1 · Kurze, klare Sätze';
  if (totalSessions >= 15 && masteredWords >= 40) {
    progressionTier = 3;
    progressionLabelDe = 'Stufe 3 · Natürliche, längere Sätze';
  } else if (totalSessions >= 5 && masteredWords >= 15) {
    progressionTier = 2;
    progressionLabelDe = 'Stufe 2 · Mittlere Sätze & Nebensätze';
  }

  const profile = getLearnerProfile();
  const sentenceComplexityPreference = profile?.sentence_complexity || 'auto';

  return {
    totalSeconds: totalRow.totalSeconds || 0,
    todaySeconds: todayRow.todaySeconds || 0,
    weekSeconds: weekRow.weekSeconds || 0,
    totalSessions,
    totalVocabulary: vocabStats.totalVocabulary || 0,
    newWordsToday: vocabStats.newWordsToday || 0,
    newWordsLast7Days: vocabStats.newWordsLast7Days || 0,
    masteredWords,
    dueWords: vocabStats.dueWords || 0,
    streakDays,
    progressionTier,
    progressionLabelDe,
    sentenceComplexityPreference,
  };
}

export function getAllPersonas() {
  return db.prepare('SELECT * FROM personas').all() as Array<{
    id: string;
    name_hanzi: string;
    name_pinyin: string;
    relationship_de: string;
    generation: string;
    age_group: string;
    voice_name: string;
    avatar_emoji: string;
    personality_prompt: string;
    speaking_style: string;
    initial_hook: string;
  }>;
}

export function getPersonaById(id: string) {
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as
    | ReturnType<typeof getAllPersonas>[number]
    | undefined;
}

export function getAllMemoryFacts() {
  return db.prepare('SELECT * FROM memory_facts ORDER BY id DESC').all() as Array<{
    id: number;
    category: string;
    fact: string;
    source_persona_id: string | null;
    created_at: string;
  }>;
}

export function addMemoryFact(category: string, fact: string, sourcePersonaId?: string) {
  // Check for exact or near duplicate
  const existing = db
    .prepare('SELECT id FROM memory_facts WHERE lower(fact) = lower(?)')
    .get(fact.trim()) as { id: number } | undefined;
  if (existing) return existing.id;

  const info = db
    .prepare('INSERT INTO memory_facts (category, fact, source_persona_id) VALUES (?, ?, ?)')
    .run(category, fact.trim(), sourcePersonaId ?? null);
  return Number(info.lastInsertRowid);
}

export function deleteMemoryFact(id: number) {
  db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
}

export function getRecentEpisodesForPersona(personaId: string, limit = 3) {
  return db
    .prepare('SELECT * FROM persona_episodes WHERE persona_id = ? ORDER BY id DESC LIMIT ?')
    .all(personaId, limit) as Array<{
    id: number;
    persona_id: string;
    session_id: number | null;
    summary: string;
    next_hook: string | null;
    created_at: string;
  }>;
}

export function getRecentFamilyEpisodesAcrossAll(limit = 5) {
  return db
    .prepare(`
      SELECT pe.*, p.name_hanzi as persona_name
      FROM persona_episodes pe
      JOIN personas p ON p.id = pe.persona_id
      ORDER BY pe.id DESC LIMIT ?
    `)
    .all(limit) as Array<{
    id: number;
    persona_id: string;
    persona_name: string;
    summary: string;
    next_hook: string | null;
    created_at: string;
  }>;
}

export function getLearnerSkills() {
  return db.prepare('SELECT * FROM learner_skill_memory ORDER BY updated_at DESC').all() as Array<{
    id: number;
    skill_name: string;
    category: string;
    status: 'struggling' | 'practicing' | 'comfortable';
    notes_de: string;
    last_example: string | null;
    updated_at: string;
  }>;
}

export function upsertLearnerSkill(
  skillName: string,
  category: string,
  status: 'struggling' | 'practicing' | 'comfortable',
  notesDe: string,
  lastExample?: string
) {
  db.prepare(`
    INSERT INTO learner_skill_memory (skill_name, category, status, notes_de, last_example, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(skill_name) DO UPDATE SET
      status = excluded.status,
      notes_de = excluded.notes_de,
      last_example = COALESCE(excluded.last_example, learner_skill_memory.last_example),
      updated_at = datetime('now')
  `).run(skillName, category, status, notesDe, lastExample ?? null);
}

export function getDueVocabulary(limit = 6) {
  return db
    .prepare(`
      SELECT * FROM vocabulary
      WHERE datetime(next_review_at) <= datetime('now', '+2 hours')
      ORDER BY datetime(next_review_at) ASC, times_used_actively ASC
      LIMIT ?
    `)
    .all(limit) as Array<{
    id: number;
    simplified_hanzi: string;
    pinyin: string;
    german: string;
    taiwan_note: string | null;
    example_hanzi: string | null;
    example_pinyin: string | null;
    example_de: string | null;
    stability: number;
    streak: number;
    times_recognized: number;
    times_used_actively: number;
    next_review_at: string;
  }>;
}

export function getAllVocabulary() {
  return db.prepare('SELECT * FROM vocabulary ORDER BY id DESC').all() as ReturnType<
    typeof getDueVocabulary
  >;
}

export function saveOrUpdateVocabulary(item: {
  simplified_hanzi: string;
  pinyin: string;
  german: string;
  taiwan_note?: string;
  example_hanzi?: string;
  example_pinyin?: string;
  example_de?: string;
}) {
  db.prepare(`
    INSERT INTO vocabulary (
      simplified_hanzi, pinyin, german, taiwan_note,
      example_hanzi, example_pinyin, example_de, next_review_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(simplified_hanzi) DO UPDATE SET
      pinyin = excluded.pinyin,
      german = excluded.german,
      taiwan_note = COALESCE(excluded.taiwan_note, vocabulary.taiwan_note),
      example_hanzi = COALESCE(excluded.example_hanzi, vocabulary.example_hanzi),
      example_pinyin = COALESCE(excluded.example_pinyin, vocabulary.example_pinyin),
      example_de = COALESCE(excluded.example_de, vocabulary.example_de)
  `).run(
    item.simplified_hanzi.trim(),
    item.pinyin.trim(),
    item.german.trim(),
    item.taiwan_note ?? null,
    item.example_hanzi ?? null,
    item.example_pinyin ?? null,
    item.example_de ?? null
  );

  return db
    .prepare('SELECT * FROM vocabulary WHERE simplified_hanzi = ?')
    .get(item.simplified_hanzi.trim()) as ReturnType<typeof getDueVocabulary>[number];
}

export function recordVocabularyReview(
  simplifiedHanzi: string,
  outcome: 'used_actively' | 'recognized' | 'forgotten'
) {
  const word = db
    .prepare('SELECT * FROM vocabulary WHERE simplified_hanzi = ?')
    .get(simplifiedHanzi.trim()) as ReturnType<typeof getDueVocabulary>[number] | undefined;

  if (!word) return null;

  let newStreak = word.streak;
  let newStability = word.stability;
  let hoursUntilNext = 4;
  let addRecognized = 0;
  let addActive = 0;

  if (outcome === 'used_actively') {
    newStreak += 1;
    newStability = Math.min(60, word.stability * 2.2 + 1);
    hoursUntilNext = Math.round(newStability * 24);
    addActive = 1;
    addRecognized = 1;
  } else if (outcome === 'recognized') {
    newStreak += 1;
    newStability = Math.min(30, word.stability * 1.5 + 0.5);
    hoursUntilNext = Math.round(newStability * 16);
    addRecognized = 1;
  } else {
    newStreak = 0;
    newStability = Math.max(0.5, word.stability * 0.5);
    hoursUntilNext = 1; // review again soon
  }

  db.prepare(`
    UPDATE vocabulary
    SET streak = ?,
        stability = ?,
        times_recognized = times_recognized + ?,
        times_used_actively = times_used_actively + ?,
        last_reviewed_at = datetime('now'),
        next_review_at = datetime('now', '+' || ? || ' hours')
    WHERE id = ?
  `).run(newStreak, newStability, addRecognized, addActive, hoursUntilNext, word.id);

  return db.prepare('SELECT * FROM vocabulary WHERE id = ?').get(word.id) as ReturnType<
    typeof getDueVocabulary
  >[number];
}

export function getAllScenarios() {
  return db
    .prepare(`
      SELECT cs.*, p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji, p.voice_name
      FROM curriculum_scenarios cs
      JOIN personas p ON p.id = cs.persona_id
      ORDER BY cs.stage_number ASC, cs.id ASC
    `)
    .all() as Array<{
    id: string;
    stage_number: number;
    stage_title_de: string;
    title_de: string;
    title_hanzi: string;
    description_de: string;
    persona_id: string;
    persona_name: string;
    persona_emoji: string;
    voice_name: string;
    target_grammar: string;
    suggested_vocab: string;
    hsk_level: string;
    mastery_score: number;
    times_practiced: number;
    last_practiced_at: string | null;
  }>;
}

export function getScenarioById(id: string) {
  return db
    .prepare(`
      SELECT cs.*, p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji, p.voice_name
      FROM curriculum_scenarios cs
      JOIN personas p ON p.id = cs.persona_id
      WHERE cs.id = ?
    `)
    .get(id) as ReturnType<typeof getAllScenarios>[number] | undefined;
}
