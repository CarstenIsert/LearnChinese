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

export const DEFAULT_USER_ID = 1;

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by_user_id INTEGER NOT NULL,
      used_by_user_id INTEGER,
      expires_at TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // Safe schema migrations for existing databases
  if (!hasColumn('sessions', 'duration_seconds')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0`);
  }

  if (!hasColumn('learner_profile', 'sentence_complexity')) {
    db.exec(
      `ALTER TABLE learner_profile ADD COLUMN sentence_complexity TEXT NOT NULL DEFAULT 'auto'`
    );
  }

  if (!hasColumn('curriculum_scenarios', 'hsk_level')) {
    db.exec(
      `ALTER TABLE curriculum_scenarios ADD COLUMN hsk_level TEXT NOT NULL DEFAULT 'HSK 3'`
    );
  }

  migrateToMultiUserSchema();
  fixPersonaForeignKeys();
  migrateMemoryLifecycleColumns();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_facts_user_status ON memory_facts(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_persona_episodes_user_persona ON persona_episodes(user_id, persona_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_ended_started ON sessions(user_id, ended_at, started_at);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_user_next_review ON vocabulary(user_id, next_review_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
  `);

  if (!hasColumn('learner_profile', 'onboarding_completed')) {
    db.exec(`ALTER TABLE learner_profile ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0`);
    db.exec(`
      UPDATE learner_profile
      SET onboarding_completed = 1
      WHERE user_id IN (SELECT DISTINCT user_id FROM sessions)
    `);
  }

  seedUserWorkspace(DEFAULT_USER_ID, { useLocalSeed: true });
}

function migrateToMultiUserSchema() {
  const needsMigration =
    !hasColumn('learner_profile', 'user_id') ||
    !hasColumn('personas', 'user_id') ||
    !hasColumn('memory_facts', 'user_id') ||
    !hasColumn('persona_episodes', 'user_id') ||
    !hasColumn('learner_skill_memory', 'user_id') ||
    !hasColumn('vocabulary', 'user_id') ||
    !hasColumn('curriculum_scenarios', 'user_id') ||
    !hasColumn('sessions', 'user_id');

  if (!needsMigration) return;

  db.pragma('foreign_keys = OFF');
  try {
    const runMigration = db.transaction(() => {
      if (!hasColumn('memory_facts', 'user_id')) {
        db.exec(`ALTER TABLE memory_facts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
      }
      if (!hasColumn('persona_episodes', 'user_id')) {
        db.exec(`ALTER TABLE persona_episodes ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
      }
      if (!hasColumn('sessions', 'user_id')) {
        db.exec(`ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
      }

      if (!hasColumn('learner_profile', 'user_id')) {
        db.exec(`
          CREATE TABLE learner_profile_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            level TEXT NOT NULL,
            native_language TEXT NOT NULL,
            summary TEXT NOT NULL,
            sentence_complexity TEXT NOT NULL DEFAULT 'auto',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO learner_profile_new (user_id, name, level, native_language, summary, sentence_complexity, updated_at)
          SELECT 1, name, level, native_language, summary, COALESCE(sentence_complexity, 'auto'), updated_at
          FROM learner_profile;
          DROP TABLE learner_profile;
          ALTER TABLE learner_profile_new RENAME TO learner_profile;
        `);
      }

      if (!hasColumn('personas', 'user_id')) {
        db.exec(`
          CREATE TABLE personas_new (
            user_id INTEGER NOT NULL DEFAULT 1,
            id TEXT NOT NULL,
            name_hanzi TEXT NOT NULL,
            name_pinyin TEXT NOT NULL,
            relationship_de TEXT NOT NULL,
            generation TEXT NOT NULL,
            age_group TEXT NOT NULL,
            voice_name TEXT NOT NULL,
            avatar_emoji TEXT NOT NULL,
            personality_prompt TEXT NOT NULL,
            speaking_style TEXT NOT NULL,
            initial_hook TEXT NOT NULL,
            PRIMARY KEY (user_id, id)
          );
          INSERT INTO personas_new (
            user_id, id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
            voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
          )
          SELECT
            1, id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
            voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
          FROM personas;
          DROP TABLE personas;
          ALTER TABLE personas_new RENAME TO personas;
        `);
      }

      if (!hasColumn('learner_skill_memory', 'user_id')) {
        db.exec(`
          CREATE TABLE learner_skill_memory_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            skill_name TEXT NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'practicing',
            notes_de TEXT NOT NULL,
            last_example TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, skill_name)
          );
          INSERT INTO learner_skill_memory_new (id, user_id, skill_name, category, status, notes_de, last_example, updated_at)
          SELECT id, 1, skill_name, category, status, notes_de, last_example, updated_at
          FROM learner_skill_memory;
          DROP TABLE learner_skill_memory;
          ALTER TABLE learner_skill_memory_new RENAME TO learner_skill_memory;
        `);
      }

      if (!hasColumn('vocabulary', 'user_id')) {
        db.exec(`
          CREATE TABLE vocabulary_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            simplified_hanzi TEXT NOT NULL,
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
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, simplified_hanzi)
          );
          INSERT INTO vocabulary_new (
            id, user_id, simplified_hanzi, pinyin, german, taiwan_note,
            example_hanzi, example_pinyin, example_de, stability, streak,
            times_recognized, times_used_actively, next_review_at, last_reviewed_at, created_at
          )
          SELECT
            id, 1, simplified_hanzi, pinyin, german, taiwan_note,
            example_hanzi, example_pinyin, example_de, stability, streak,
            times_recognized, times_used_actively, next_review_at, last_reviewed_at, created_at
          FROM vocabulary;
          DROP TABLE vocabulary;
          ALTER TABLE vocabulary_new RENAME TO vocabulary;
        `);
      }

      if (!hasColumn('curriculum_scenarios', 'user_id')) {
        db.exec(`
          CREATE TABLE curriculum_scenarios_new (
            user_id INTEGER NOT NULL DEFAULT 1,
            id TEXT NOT NULL,
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
            PRIMARY KEY (user_id, id),
            FOREIGN KEY (user_id, persona_id) REFERENCES personas(user_id, id)
          );
          INSERT INTO curriculum_scenarios_new (
            user_id, id, stage_number, stage_title_de, title_de, title_hanzi,
            description_de, persona_id, target_grammar, suggested_vocab, hsk_level,
            mastery_score, times_practiced, last_practiced_at
          )
          SELECT
            1, id, stage_number, stage_title_de, title_de, title_hanzi,
            description_de, persona_id, target_grammar, suggested_vocab, COALESCE(hsk_level, 'HSK 3'),
            mastery_score, times_practiced, last_practiced_at
          FROM curriculum_scenarios;
          DROP TABLE curriculum_scenarios;
          ALTER TABLE curriculum_scenarios_new RENAME TO curriculum_scenarios;
        `);
      }
    });
    runMigration();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function hasSingleColumnPersonaFk(table: string): boolean {
  const fks = db.pragma(`foreign_key_list(${table})`) as Array<{
    table: string;
    from: string;
  }>;
  const personaFks = fks.filter((fk) => fk.table === 'personas');
  return personaFks.length === 1 && personaFks[0].from === 'persona_id';
}

function fixPersonaForeignKeys() {
  const fixEpisodes = hasSingleColumnPersonaFk('persona_episodes');
  const fixSessions = hasSingleColumnPersonaFk('sessions');
  if (!fixEpisodes && !fixSessions) return;

  db.pragma('foreign_keys = OFF');
  try {
    const runFix = db.transaction(() => {
      if (fixEpisodes) {
        db.exec(`
          CREATE TABLE persona_episodes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            persona_id TEXT NOT NULL,
            session_id INTEGER,
            summary TEXT NOT NULL,
            next_hook TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id, persona_id) REFERENCES personas(user_id, id)
          );
          INSERT INTO persona_episodes_new (
            id, user_id, persona_id, session_id, summary, next_hook, created_at
          )
          SELECT
            id, user_id, persona_id, session_id, summary, next_hook, created_at
          FROM persona_episodes;
          DROP TABLE persona_episodes;
          ALTER TABLE persona_episodes_new RENAME TO persona_episodes;
        `);
      }

      if (fixSessions) {
        db.exec(`
          CREATE TABLE sessions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            persona_id TEXT NOT NULL,
            scenario_id TEXT,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            transcript_json TEXT NOT NULL DEFAULT '[]',
            summary_de TEXT,
            coaching_notes_json TEXT,
            extracted_memories_json TEXT,
            FOREIGN KEY (user_id, persona_id) REFERENCES personas(user_id, id)
          );
          INSERT INTO sessions_new (
            id, user_id, persona_id, scenario_id, started_at, ended_at,
            duration_seconds, transcript_json, summary_de, coaching_notes_json,
            extracted_memories_json
          )
          SELECT
            id, user_id, persona_id, scenario_id, started_at, ended_at,
            COALESCE(duration_seconds, 0), COALESCE(transcript_json, '[]'), summary_de,
            coaching_notes_json, extracted_memories_json
          FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
        `);
      }
    });
    runFix();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function seedUserWorkspace(
  userId: number,
  options?: { displayName?: string; useLocalSeed?: boolean }
) {
  const runSeed = db.transaction(() => {
    const seedData = options?.useLocalSeed ? loadLocalOrGenericSeed() : GENERIC_SEED_PROFILE;
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

  const personaCount = (
    db.prepare('SELECT COUNT(*) as c FROM personas WHERE user_id = ?').get(userId) as { c: number }
  ).c;
  if (personaCount === 0) {
    const insertPersona = db.prepare(`
      INSERT OR IGNORE INTO personas (
        user_id, id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
        voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
      ) VALUES (
        @user_id, @id, @name_hanzi, @name_pinyin, @relationship_de, @generation, @age_group,
        @voice_name, @avatar_emoji, @personality_prompt, @speaking_style, @initial_hook
      )
    `);
    for (const p of personasToSeed) {
      insertPersona.run({ ...p, user_id: userId });
    }
  }

  const scenarioCount = (
    db.prepare('SELECT COUNT(*) as c FROM curriculum_scenarios WHERE user_id = ?').get(userId) as {
      c: number;
    }
  ).c;
  if (scenarioCount === 0) {
    const insertScenario = db.prepare(`
      INSERT OR IGNORE INTO curriculum_scenarios (
        user_id, id, stage_number, stage_title_de, title_de, title_hanzi,
        description_de, persona_id, target_grammar, suggested_vocab
      ) VALUES (
        @user_id, @id, @stage_number, @stage_title_de, @title_de, @title_hanzi,
        @description_de, @persona_id, @target_grammar, @suggested_vocab
      )
    `);
    for (const s of scenariosToSeed) {
      insertScenario.run({ ...s, user_id: userId });
    }
  }

  const vocabCount = (
    db.prepare('SELECT COUNT(*) as c FROM vocabulary WHERE user_id = ?').get(userId) as { c: number }
  ).c;
  if (vocabCount === 0) {
    const insertVocab = db.prepare(`
      INSERT OR IGNORE INTO vocabulary (
        user_id, simplified_hanzi, pinyin, german, taiwan_note,
        example_hanzi, example_pinyin, example_de, next_review_at
      ) VALUES (
        @user_id, @simplified_hanzi, @pinyin, @german, @taiwan_note,
        @example_hanzi, @example_pinyin, @example_de, datetime('now')
      )
    `);
    for (const v of INITIAL_DEFAULT_VOCAB) {
      insertVocab.run({ ...v, user_id: userId });
    }
  }

  const skillCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM learner_skill_memory WHERE user_id = ?')
      .get(userId) as { c: number }
  ).c;
  if (skillCount === 0) {
    const insertSkill = db.prepare(`
      INSERT OR IGNORE INTO learner_skill_memory (user_id, skill_name, category, status, notes_de, last_example)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const sk of skillsToSeed) {
      insertSkill.run(userId, sk.skill_name, sk.category, sk.status, sk.notes_de, sk.last_example);
    }
  }

  const existingProfile = db
    .prepare('SELECT id FROM learner_profile WHERE user_id = ?')
    .get(userId);
  if (!existingProfile) {
    const profileName = options?.displayName?.trim() || seedData.learnerProfile.name;
    db.prepare(`
      INSERT INTO learner_profile (user_id, name, level, native_language, summary)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      userId,
      profileName,
      seedData.learnerProfile.level,
      seedData.learnerProfile.nativeLanguage,
      seedData.learnerProfile.summary
    );

    const insertFact = db.prepare(`
      INSERT INTO memory_facts (user_id, category, fact, source_persona_id)
      VALUES (?, ?, ?, 'system-init')
    `);
    for (const f of seedData.memoryFacts) {
      insertFact.run(userId, f.category, f.fact);
    }
  }
  });
  runSeed();
}

// Helper queries for the Memory Engine & API
export function getLearnerProfile(userId = DEFAULT_USER_ID) {
  return db.prepare('SELECT * FROM learner_profile WHERE user_id = ?').get(userId) as {
    id: number;
    user_id: number;
    name: string;
    level: string;
    native_language: string;
    summary: string;
    sentence_complexity?: 'auto' | 'short' | 'medium' | 'natural';
    onboarding_completed?: number;
  };
}

export function updateLearnerProfile(
  updates: {
    name?: string;
    level?: string;
    summary?: string;
    onboarding_completed?: number;
  },
  userId = DEFAULT_USER_ID
) {
  const existing = getLearnerProfile(userId);
  if (!existing) return null;
  const name = updates.name !== undefined ? updates.name.trim() || existing.name : existing.name;
  const level = updates.level !== undefined ? updates.level.trim() || existing.level : existing.level;
  const summary =
    updates.summary !== undefined ? updates.summary.trim() || existing.summary : existing.summary;
  const onboardingCompleted =
    updates.onboarding_completed !== undefined
      ? updates.onboarding_completed
      : existing.onboarding_completed ?? 0;

  db.prepare(
    `UPDATE learner_profile
     SET name = ?, level = ?, summary = ?, onboarding_completed = ?, updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(name, level, summary, onboardingCompleted, userId);

  return getLearnerProfile(userId);
}

export function updateSentenceComplexityPreference(
  preference: 'auto' | 'short' | 'medium' | 'natural',
  userId = DEFAULT_USER_ID
) {
  db.prepare(
    `UPDATE learner_profile SET sentence_complexity = ?, updated_at = datetime('now') WHERE user_id = ?`
  ).run(preference, userId);
}

export function getLearningStats(userId = DEFAULT_USER_ID) {
  const durationExpr = `CASE WHEN duration_seconds > 0 THEN duration_seconds WHEN ended_at IS NOT NULL THEN MAX(0, CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) ELSE 0 END`;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as totalSessions, COALESCE(SUM(${durationExpr}), 0) as totalSeconds FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL`
    )
    .get(userId) as { totalSessions: number; totalSeconds: number };

  const todayRow = db
    .prepare(
      `SELECT COALESCE(SUM(${durationExpr}), 0) as todaySeconds FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL AND date(started_at, 'localtime') = date('now', 'localtime')`
    )
    .get(userId) as { todaySeconds: number };

  const weekRow = db
    .prepare(
      `SELECT COALESCE(SUM(${durationExpr}), 0) as weekSeconds FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL AND datetime(started_at) >= datetime('now', '-7 days')`
    )
    .get(userId) as { weekSeconds: number };

  const vocabStats = db
    .prepare(
      `SELECT
         COUNT(*) as totalVocabulary,
         SUM(CASE WHEN date(created_at, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END) as newWordsToday,
         SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as newWordsLast7Days,
         SUM(CASE WHEN streak >= 2 OR times_used_actively >= 1 THEN 1 ELSE 0 END) as masteredWords,
         SUM(CASE WHEN datetime(next_review_at) <= datetime('now', '+2 hours') THEN 1 ELSE 0 END) as dueWords
       FROM vocabulary
       WHERE user_id = ?`
    )
    .get(userId) as {
    totalVocabulary: number;
    newWordsToday: number;
    newWordsLast7Days: number;
    masteredWords: number;
    dueWords: number;
  };

  // Compute consecutive learning day streak (UTC/localtime dates)
  const sessionDays = db
    .prepare(
      `SELECT DISTINCT date(started_at, 'localtime') as day FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL ORDER BY day DESC`
    )
    .all(userId) as Array<{ day: string }>;

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

  const profile = getLearnerProfile(userId);
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

export function getAllPersonas(userId = DEFAULT_USER_ID) {
  return db.prepare('SELECT * FROM personas WHERE user_id = ?').all(userId) as Array<{
    user_id: number;
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

export function getPersonaById(id: string, userId = DEFAULT_USER_ID) {
  return db.prepare('SELECT * FROM personas WHERE user_id = ? AND id = ?').get(userId, id) as
    | ReturnType<typeof getAllPersonas>[number]
    | undefined;
}

export interface UpsertPersonaInput {
  id?: string;
  name_hanzi: string;
  name_pinyin: string;
  relationship_de: string;
  generation?: string;
  age_group?: string;
  voice_name?: string;
  avatar_emoji?: string;
  personality_prompt?: string;
  speaking_style?: string;
  initial_hook?: string;
}

/** Create or update a conversation persona for a user, filling sensible defaults for optional fields. */
export function upsertPersona(input: UpsertPersonaInput, userId = DEFAULT_USER_ID) {
  const nameHanzi = input.name_hanzi.trim();
  const namePinyin = input.name_pinyin.trim() || nameHanzi;
  const relationshipDe = input.relationship_de.trim();
  const ageGroup = input.age_group?.trim() || 'Erwachsene';
  const generation = input.generation?.trim() || ageGroup;
  const voiceName = input.voice_name?.trim() || 'Aoede';
  const avatarEmoji = input.avatar_emoji?.trim() || '🧑';
  const personalityPrompt =
    input.personality_prompt?.trim() ||
    `You are ${nameHanzi} (${namePinyin}), the learner's ${relationshipDe} (${ageGroup}). Be warm, patient, and supportive in everyday Mandarin conversations.`;
  const speakingStyle =
    input.speaking_style?.trim() ||
    'Natural, clear, encouraging everyday Mandarin adapted to the learner level.';
  const initialHook =
    input.initial_hook?.trim() ||
    `Frage ${nameHanzi} nach dem Alltag, aktuellen Plänen oder einem gemeinsamen Thema.`;

  const existing = input.id ? getPersonaById(input.id, userId) : undefined;
  const personaId =
    existing?.id ||
    input.id?.trim() ||
    `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  if (existing) {
    db.prepare(`
      UPDATE personas
      SET name_hanzi = ?, name_pinyin = ?, relationship_de = ?, generation = ?,
          age_group = ?, voice_name = ?, avatar_emoji = ?, personality_prompt = ?,
          speaking_style = ?, initial_hook = ?
      WHERE user_id = ? AND id = ?
    `).run(
      nameHanzi,
      namePinyin,
      relationshipDe,
      generation,
      ageGroup,
      voiceName,
      avatarEmoji,
      personalityPrompt,
      speakingStyle,
      initialHook,
      userId,
      personaId
    );
  } else {
    db.prepare(`
      INSERT INTO personas (
        user_id, id, name_hanzi, name_pinyin, relationship_de, generation,
        age_group, voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      personaId,
      nameHanzi,
      namePinyin,
      relationshipDe,
      generation,
      ageGroup,
      voiceName,
      avatarEmoji,
      personalityPrompt,
      speakingStyle,
      initialHook
    );
  }

  return getPersonaById(personaId, userId)!;
}

/** Delete a persona and clean up dependent records; prevents deleting the last remaining persona. */
export function deletePersona(personaId: string, userId = DEFAULT_USER_ID): { ok: boolean; error?: string } {
  const all = getAllPersonas(userId);
  const target = all.find((p) => p.id === personaId);
  if (!target) {
    return { ok: false, error: 'Person nicht gefunden.' };
  }
  if (all.length <= 1) {
    return { ok: false, error: 'Mindestens ein Gesprächspartner muss erhalten bleiben.' };
  }
  const fallback = all.find((p) => p.id !== personaId)!;

  const runDelete = db.transaction(() => {
    db.prepare('DELETE FROM curriculum_scenarios WHERE user_id = ? AND persona_id = ?').run(
      userId,
      personaId
    );
    db.prepare('DELETE FROM persona_episodes WHERE user_id = ? AND persona_id = ?').run(
      userId,
      personaId
    );
    db.prepare('UPDATE sessions SET persona_id = ? WHERE user_id = ? AND persona_id = ?').run(
      fallback.id,
      userId,
      personaId
    );
    db.prepare('DELETE FROM personas WHERE user_id = ? AND id = ?').run(userId, personaId);
  });

  runDelete();
  return { ok: true };
}

export type MemoryTier = 'core' | 'episodic';

export interface MemoryFactRow {
  id: number;
  user_id: number;
  category: string;
  fact: string;
  tier: MemoryTier;
  status: 'active' | 'archived';
  source_persona_id: string | null;
  last_referenced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryFactWithEmbedding extends MemoryFactRow {
  embedding: string | null;
}

export interface PersonaEpisodeWithEmbedding {
  id: number;
  user_id: number;
  persona_id: string;
  persona_name: string;
  session_id: number | null;
  summary: string;
  next_hook: string | null;
  embedding: string | null;
  last_referenced_at: string | null;
  created_at: string;
}

function migrateMemoryLifecycleColumns() {
  if (!hasColumn('memory_facts', 'tier')) {
    db.exec(`ALTER TABLE memory_facts ADD COLUMN tier TEXT NOT NULL DEFAULT 'episodic'`);
  }
  if (!hasColumn('memory_facts', 'status')) {
    db.exec(`ALTER TABLE memory_facts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!hasColumn('memory_facts', 'embedding')) {
    db.exec(`ALTER TABLE memory_facts ADD COLUMN embedding TEXT`);
  }
  if (!hasColumn('memory_facts', 'last_referenced_at')) {
    db.exec(`ALTER TABLE memory_facts ADD COLUMN last_referenced_at TEXT`);
  }
  if (!hasColumn('persona_episodes', 'embedding')) {
    db.exec(`ALTER TABLE persona_episodes ADD COLUMN embedding TEXT`);
  }
  if (!hasColumn('persona_episodes', 'last_referenced_at')) {
    db.exec(`ALTER TABLE persona_episodes ADD COLUMN last_referenced_at TEXT`);
  }
}

export function getAllMemoryFacts(userId = DEFAULT_USER_ID): MemoryFactRow[] {
  return db
    .prepare(
      `SELECT id, user_id, category, fact, tier, status, source_persona_id, last_referenced_at, created_at, updated_at
       FROM memory_facts
       WHERE user_id = ? AND status = 'active'
       ORDER BY id DESC`
    )
    .all(userId) as MemoryFactRow[];
}

export function getActiveMemoryFactsWithEmbeddings(
  userId = DEFAULT_USER_ID
): MemoryFactWithEmbedding[] {
  return db
    .prepare(
      `SELECT id, user_id, category, fact, tier, status, source_persona_id, embedding, last_referenced_at, created_at, updated_at
       FROM memory_facts
       WHERE user_id = ? AND status = 'active'
       ORDER BY id DESC`
    )
    .all(userId) as MemoryFactWithEmbedding[];
}

export function addMemoryFact(
  category: string,
  fact: string,
  sourcePersonaId?: string,
  userId = DEFAULT_USER_ID,
  tier: MemoryTier = 'episodic'
) {
  // Check for exact or near duplicate among active facts
  const existing = db
    .prepare(
      "SELECT id FROM memory_facts WHERE user_id = ? AND status = 'active' AND lower(fact) = lower(?)"
    )
    .get(userId, fact.trim()) as { id: number } | undefined;
  if (existing) return existing.id;

  const normalizedTier: MemoryTier = tier === 'core' ? 'core' : 'episodic';
  const info = db
    .prepare(
      "INSERT INTO memory_facts (user_id, category, fact, tier, status, source_persona_id) VALUES (?, ?, ?, ?, 'active', ?)"
    )
    .run(userId, category, fact.trim(), normalizedTier, sourcePersonaId ?? null);
  return Number(info.lastInsertRowid);
}

export function updateMemoryFact(
  id: number,
  updates: { fact?: string; category?: string; tier?: MemoryTier },
  userId = DEFAULT_USER_ID
) {
  const existing = db
    .prepare("SELECT id, fact, category, tier FROM memory_facts WHERE id = ? AND user_id = ? AND status = 'active'")
    .get(id, userId) as { id: number; fact: string; category: string; tier: MemoryTier } | undefined;
  if (!existing) return false;

  const nextFact = updates.fact?.trim() || existing.fact;
  const nextCategory = updates.category?.trim() || existing.category;
  const nextTier: MemoryTier =
    updates.tier === 'core' || updates.tier === 'episodic' ? updates.tier : existing.tier;
  const factChanged = nextFact !== existing.fact;

  db.prepare(
    `UPDATE memory_facts
     SET fact = ?,
         category = ?,
         tier = ?,
         embedding = CASE WHEN ? THEN NULL ELSE embedding END,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(nextFact, nextCategory, nextTier, factChanged ? 1 : 0, id, userId);
  return true;
}

export function archiveMemoryFact(id: number, userId = DEFAULT_USER_ID) {
  db.prepare(
    "UPDATE memory_facts SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(id, userId);
}

export function deleteMemoryFact(id: number, userId = DEFAULT_USER_ID) {
  db.prepare('DELETE FROM memory_facts WHERE id = ? AND user_id = ?').run(id, userId);
}

export function saveMemoryFactEmbedding(id: number, embeddingJson: string, userId = DEFAULT_USER_ID) {
  db.prepare('UPDATE memory_facts SET embedding = ? WHERE id = ? AND user_id = ?').run(
    embeddingJson,
    id,
    userId
  );
}

export function touchMemoryFactsReferenced(ids: number[], userId = DEFAULT_USER_ID) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(
    `UPDATE memory_facts SET last_referenced_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`
  ).run(userId, ...ids);
}

export function getPersonaEpisodesWithEmbeddings(
  userId = DEFAULT_USER_ID
): PersonaEpisodeWithEmbedding[] {
  return db
    .prepare(`
      SELECT pe.id, pe.user_id, pe.persona_id, p.name_hanzi as persona_name,
             pe.session_id, pe.summary, pe.next_hook, pe.embedding, pe.last_referenced_at, pe.created_at
      FROM persona_episodes pe
      JOIN personas p ON p.id = pe.persona_id AND p.user_id = pe.user_id
      WHERE pe.user_id = ?
      ORDER BY pe.id DESC
    `)
    .all(userId) as PersonaEpisodeWithEmbedding[];
}

export function savePersonaEpisodeEmbedding(
  id: number,
  embeddingJson: string,
  userId = DEFAULT_USER_ID
) {
  db.prepare('UPDATE persona_episodes SET embedding = ? WHERE id = ? AND user_id = ?').run(
    embeddingJson,
    id,
    userId
  );
}

export function touchPersonaEpisodesReferenced(ids: number[], userId = DEFAULT_USER_ID) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(
    `UPDATE persona_episodes SET last_referenced_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`
  ).run(userId, ...ids);
}

export function getRecentEpisodesForPersona(
  personaId: string,
  limit = 3,
  userId = DEFAULT_USER_ID
) {
  return db
    .prepare(
      'SELECT * FROM persona_episodes WHERE user_id = ? AND persona_id = ? ORDER BY id DESC LIMIT ?'
    )
    .all(userId, personaId, limit) as Array<{
    id: number;
    user_id: number;
    persona_id: string;
    session_id: number | null;
    summary: string;
    next_hook: string | null;
    created_at: string;
  }>;
}

export function getRecentFamilyEpisodesAcrossAll(limit = 5, userId = DEFAULT_USER_ID) {
  return db
    .prepare(`
      SELECT pe.*, p.name_hanzi as persona_name
      FROM persona_episodes pe
      JOIN personas p ON p.id = pe.persona_id AND p.user_id = pe.user_id
      WHERE pe.user_id = ?
      ORDER BY pe.id DESC LIMIT ?
    `)
    .all(userId, limit) as Array<{
    id: number;
    user_id: number;
    persona_id: string;
    persona_name: string;
    summary: string;
    next_hook: string | null;
    created_at: string;
  }>;
}

export function getLearnerSkills(userId = DEFAULT_USER_ID) {
  return db
    .prepare('SELECT * FROM learner_skill_memory WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as Array<{
    id: number;
    user_id: number;
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
  lastExample?: string,
  userId = DEFAULT_USER_ID
) {
  db.prepare(`
    INSERT INTO learner_skill_memory (user_id, skill_name, category, status, notes_de, last_example, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, skill_name) DO UPDATE SET
      status = excluded.status,
      notes_de = excluded.notes_de,
      last_example = COALESCE(excluded.last_example, learner_skill_memory.last_example),
      updated_at = datetime('now')
  `).run(userId, skillName, category, status, notesDe, lastExample ?? null);
}

export function getDueVocabulary(limit = 6, userId = DEFAULT_USER_ID) {
  return db
    .prepare(`
      SELECT * FROM vocabulary
      WHERE user_id = ? AND datetime(next_review_at) <= datetime('now', '+2 hours')
      ORDER BY datetime(next_review_at) ASC, times_used_actively ASC
      LIMIT ?
    `)
    .all(userId, limit) as Array<{
    id: number;
    user_id: number;
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

export function getAllVocabulary(userId = DEFAULT_USER_ID) {
  return db
    .prepare('SELECT * FROM vocabulary WHERE user_id = ? ORDER BY id DESC')
    .all(userId) as ReturnType<typeof getDueVocabulary>;
}

export function saveOrUpdateVocabulary(
  item: {
    simplified_hanzi: string;
    pinyin: string;
    german: string;
    taiwan_note?: string;
    example_hanzi?: string;
    example_pinyin?: string;
    example_de?: string;
  },
  userId = DEFAULT_USER_ID
) {
  db.prepare(`
    INSERT INTO vocabulary (
      user_id, simplified_hanzi, pinyin, german, taiwan_note,
      example_hanzi, example_pinyin, example_de, next_review_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, simplified_hanzi) DO UPDATE SET
      pinyin = excluded.pinyin,
      german = excluded.german,
      taiwan_note = COALESCE(excluded.taiwan_note, vocabulary.taiwan_note),
      example_hanzi = COALESCE(excluded.example_hanzi, vocabulary.example_hanzi),
      example_pinyin = COALESCE(excluded.example_pinyin, vocabulary.example_pinyin),
      example_de = COALESCE(excluded.example_de, vocabulary.example_de)
  `).run(
    userId,
    item.simplified_hanzi.trim(),
    item.pinyin.trim(),
    item.german.trim(),
    item.taiwan_note ?? null,
    item.example_hanzi ?? null,
    item.example_pinyin ?? null,
    item.example_de ?? null
  );

  return db
    .prepare('SELECT * FROM vocabulary WHERE user_id = ? AND simplified_hanzi = ?')
    .get(userId, item.simplified_hanzi.trim()) as ReturnType<typeof getDueVocabulary>[number];
}

export function recordVocabularyReview(
  simplifiedHanzi: string,
  outcome: 'used_actively' | 'recognized' | 'forgotten',
  userId = DEFAULT_USER_ID
) {
  if (typeof simplifiedHanzi !== 'string' || !simplifiedHanzi.trim()) return null;
  if (outcome !== 'used_actively' && outcome !== 'recognized' && outcome !== 'forgotten') {
    return null;
  }

  const word = db
    .prepare('SELECT * FROM vocabulary WHERE user_id = ? AND simplified_hanzi = ?')
    .get(userId, simplifiedHanzi.trim()) as ReturnType<typeof getDueVocabulary>[number] | undefined;

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
    WHERE id = ? AND user_id = ?
  `).run(newStreak, newStability, addRecognized, addActive, hoursUntilNext, word.id, userId);

  return db
    .prepare('SELECT * FROM vocabulary WHERE id = ? AND user_id = ?')
    .get(word.id, userId) as ReturnType<typeof getDueVocabulary>[number];
}

export function getAllScenarios(userId = DEFAULT_USER_ID) {
  return db
    .prepare(`
      SELECT cs.*, p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji, p.voice_name
      FROM curriculum_scenarios cs
      JOIN personas p ON p.id = cs.persona_id AND p.user_id = cs.user_id
      WHERE cs.user_id = ?
      ORDER BY cs.stage_number ASC, cs.id ASC
    `)
    .all(userId) as Array<{
    user_id: number;
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

export function getScenarioById(id: string, userId = DEFAULT_USER_ID) {
  return db
    .prepare(`
      SELECT cs.*, p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji, p.voice_name
      FROM curriculum_scenarios cs
      JOIN personas p ON p.id = cs.persona_id AND p.user_id = cs.user_id
      WHERE cs.user_id = ? AND cs.id = ?
    `)
    .get(userId, id) as ReturnType<typeof getAllScenarios>[number] | undefined;
}

export function getRecentSessions(userId = DEFAULT_USER_ID, limit = 10) {
  return db
    .prepare(`
      SELECT s.id, s.persona_id, s.scenario_id, s.started_at, s.ended_at, s.duration_seconds, s.summary_de,
             p.name_hanzi as persona_name, p.avatar_emoji as persona_emoji
      FROM sessions s
      JOIN personas p ON p.id = s.persona_id AND p.user_id = s.user_id
      WHERE s.user_id = ? AND s.ended_at IS NOT NULL
      ORDER BY s.id DESC LIMIT ?
    `)
    .all(userId, limit);
}

export function createSessionRecord(
  personaId: string,
  scenarioId: string | null,
  userId = DEFAULT_USER_ID
): number {
  const info = db
    .prepare('INSERT INTO sessions (user_id, persona_id, scenario_id) VALUES (?, ?, ?)')
    .run(userId, personaId, scenarioId);
  return Number(info.lastInsertRowid);
}

export function deleteUserAccount(userId: number): { ok: boolean; error?: string } {
  const user = db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(userId) as
    | { id: number; role: string }
    | undefined;
  if (!user) {
    return { ok: false, error: 'Account not found.' };
  }

  if (user.role === 'admin') {
    const otherUsers = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE id != ?`).get(userId) as { c: number }
    ).c;
    const otherAdmins = (
      db.prepare(`SELECT COUNT(*) as c FROM users WHERE id != ? AND role = 'admin'`).get(userId) as {
        c: number;
      }
    ).c;
    if (otherUsers > 0 && otherAdmins === 0) {
      return {
        ok: false,
        error: 'Der letzte Admin-Account kann nicht gelöscht werden, solange noch andere Nutzer existieren.',
      };
    }
  }

  const runDelete = db.transaction(() => {
    db.prepare(`DELETE FROM persona_episodes WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM curriculum_scenarios WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM memory_facts WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM learner_skill_memory WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM vocabulary WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM personas WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM learner_profile WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });

  runDelete();
  return { ok: true };
}
