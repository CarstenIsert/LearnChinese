/**
 * Imports learning data (profile, personas, sessions, vocabulary, memory facts,
 * persona episodes, skill memory, and curriculum scenarios) from a source SQLite
 * database into a target SQLite database for a single user account, while
 * preserving the target database's authentication tables (`users`, `auth_sessions`,
 * `invite_codes`).
 *
 * Usage:
 *   node scripts/import-learning-data.mjs --source /tmp/local_tutor_export.db [--target data/tutor.db] [--target-user-id 1] [--source-user-id 1]
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(process.cwd(), 'package.json'));
const Database = require('better-sqlite3');

function parseArgs(argv) {
  const args = {
    source: '',
    target: path.resolve(process.cwd(), 'data', 'tutor.db'),
    targetUserId: null,
    sourceUserId: null,
    backup: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) {
      args.source = path.resolve(argv[++i]);
    } else if (arg === '--target' && argv[i + 1]) {
      args.target = path.resolve(argv[++i]);
    } else if (arg === '--target-user-id' && argv[i + 1]) {
      args.targetUserId = Number(argv[++i]);
    } else if (arg === '--source-user-id' && argv[i + 1]) {
      args.sourceUserId = Number(argv[++i]);
    } else if (arg === '--no-backup') {
      args.backup = false;
    }
  }

  if (!args.source) {
    console.error('Error: --source <path> is required.');
    process.exit(1);
  }

  return args;
}

function resolveSingleUserId(db, explicitId, label) {
  if (explicitId !== null) {
    if (!Number.isInteger(explicitId) || explicitId <= 0) {
      throw new Error(`Invalid ${label} user ID: ${explicitId}`);
    }
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(explicitId);
    if (!row) {
      throw new Error(`User ID ${explicitId} not found in ${label} database.`);
    }
    return explicitId;
  }

  const users = db.prepare('SELECT id FROM users ORDER BY id ASC').all();
  if (users.length !== 1) {
    throw new Error(
      `Expected exactly 1 user in ${label} database, found ${users.length}. Pass --${label}-user-id explicitly.`
    );
  }
  return users[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDb = new Database(args.source, { readonly: true });
  const targetDb = new Database(args.target);
  targetDb.pragma('foreign_keys = ON');

  try {
    const sourceUserId = resolveSingleUserId(sourceDb, args.sourceUserId, 'source');
    const targetUserId = resolveSingleUserId(targetDb, args.targetUserId, 'target');

    if (args.backup) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${args.target}.bak-${stamp}`;
      await targetDb.backup(backupPath);
      console.log(`Created backup: ${backupPath}`);
    }

    const importTx = targetDb.transaction(() => {
      // Clear existing learning data for targetUserId in reverse FK order.
      targetDb.prepare('DELETE FROM persona_episodes WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM curriculum_scenarios WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM memory_facts WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM learner_skill_memory WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM vocabulary WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM learner_profile WHERE user_id = ?').run(targetUserId);
      targetDb.prepare('DELETE FROM personas WHERE user_id = ?').run(targetUserId);

      // 1. learner_profile
      const profiles = sourceDb
        .prepare(
          `SELECT name, level, native_language, summary, sentence_complexity, updated_at, onboarding_completed
           FROM learner_profile WHERE user_id = ?`
        )
        .all(sourceUserId);
      const insertProfile = targetDb.prepare(
        `INSERT INTO learner_profile (user_id, name, level, native_language, summary, sentence_complexity, updated_at, onboarding_completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of profiles) {
        insertProfile.run(
          targetUserId,
          p.name,
          p.level,
          p.native_language,
          p.summary,
          p.sentence_complexity,
          p.updated_at,
          p.onboarding_completed
        );
      }

      // 2. personas
      const personas = sourceDb
        .prepare(
          `SELECT id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
                  voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
           FROM personas WHERE user_id = ?`
        )
        .all(sourceUserId);
      const insertPersona = targetDb.prepare(
        `INSERT INTO personas (
           user_id, id, name_hanzi, name_pinyin, relationship_de, generation, age_group,
           voice_name, avatar_emoji, personality_prompt, speaking_style, initial_hook
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of personas) {
        insertPersona.run(
          targetUserId,
          p.id,
          p.name_hanzi,
          p.name_pinyin,
          p.relationship_de,
          p.generation,
          p.age_group,
          p.voice_name,
          p.avatar_emoji,
          p.personality_prompt,
          p.speaking_style,
          p.initial_hook
        );
      }

      // 3. memory_facts
      const facts = sourceDb
        .prepare(
          `SELECT category, fact, source_persona_id, created_at, updated_at
           FROM memory_facts WHERE user_id = ? ORDER BY id ASC`
        )
        .all(sourceUserId);
      const insertFact = targetDb.prepare(
        `INSERT INTO memory_facts (user_id, category, fact, source_persona_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const f of facts) {
        insertFact.run(targetUserId, f.category, f.fact, f.source_persona_id, f.created_at, f.updated_at);
      }

      // 4. learner_skill_memory
      const skills = sourceDb
        .prepare(
          `SELECT skill_name, category, status, notes_de, last_example, updated_at
           FROM learner_skill_memory WHERE user_id = ? ORDER BY id ASC`
        )
        .all(sourceUserId);
      const insertSkill = targetDb.prepare(
        `INSERT INTO learner_skill_memory (user_id, skill_name, category, status, notes_de, last_example, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of skills) {
        insertSkill.run(targetUserId, s.skill_name, s.category, s.status, s.notes_de, s.last_example, s.updated_at);
      }

      // 5. vocabulary
      const vocab = sourceDb
        .prepare(
          `SELECT simplified_hanzi, pinyin, german, taiwan_note, example_hanzi, example_pinyin,
                  example_de, stability, streak, times_recognized, times_used_actively,
                  next_review_at, last_reviewed_at, created_at
           FROM vocabulary WHERE user_id = ? ORDER BY id ASC`
        )
        .all(sourceUserId);
      const insertVocab = targetDb.prepare(
        `INSERT INTO vocabulary (
           user_id, simplified_hanzi, pinyin, german, taiwan_note, example_hanzi, example_pinyin,
           example_de, stability, streak, times_recognized, times_used_actively,
           next_review_at, last_reviewed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of vocab) {
        insertVocab.run(
          targetUserId,
          v.simplified_hanzi,
          v.pinyin,
          v.german,
          v.taiwan_note,
          v.example_hanzi,
          v.example_pinyin,
          v.example_de,
          v.stability,
          v.streak,
          v.times_recognized,
          v.times_used_actively,
          v.next_review_at,
          v.last_reviewed_at,
          v.created_at
        );
      }

      // 6. curriculum_scenarios
      const scenarios = sourceDb
        .prepare(
          `SELECT id, stage_number, stage_title_de, title_de, title_hanzi, description_de,
                  persona_id, target_grammar, suggested_vocab, hsk_level, mastery_score,
                  times_practiced, last_practiced_at
           FROM curriculum_scenarios WHERE user_id = ?`
        )
        .all(sourceUserId);
      const insertScenario = targetDb.prepare(
        `INSERT INTO curriculum_scenarios (
           user_id, id, stage_number, stage_title_de, title_de, title_hanzi, description_de,
           persona_id, target_grammar, suggested_vocab, hsk_level, mastery_score,
           times_practiced, last_practiced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const sc of scenarios) {
        insertScenario.run(
          targetUserId,
          sc.id,
          sc.stage_number,
          sc.stage_title_de,
          sc.title_de,
          sc.title_hanzi,
          sc.description_de,
          sc.persona_id,
          sc.target_grammar,
          sc.suggested_vocab,
          sc.hsk_level,
          sc.mastery_score,
          sc.times_practiced,
          sc.last_practiced_at
        );
      }

      // 7. sessions (remap session IDs for persona_episodes)
      const sessions = sourceDb
        .prepare(
          `SELECT id, persona_id, scenario_id, started_at, ended_at, duration_seconds,
                  transcript_json, summary_de, coaching_notes_json, extracted_memories_json
           FROM sessions WHERE user_id = ? ORDER BY id ASC`
        )
        .all(sourceUserId);
      const insertSession = targetDb.prepare(
        `INSERT INTO sessions (
           user_id, persona_id, scenario_id, started_at, ended_at, duration_seconds,
           transcript_json, summary_de, coaching_notes_json, extracted_memories_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const sessionIdMap = new Map();
      for (const s of sessions) {
        const info = insertSession.run(
          targetUserId,
          s.persona_id,
          s.scenario_id,
          s.started_at,
          s.ended_at,
          s.duration_seconds,
          s.transcript_json,
          s.summary_de,
          s.coaching_notes_json,
          s.extracted_memories_json
        );
        sessionIdMap.set(s.id, Number(info.lastInsertRowid));
      }

      // 8. persona_episodes
      const episodes = sourceDb
        .prepare(
          `SELECT persona_id, session_id, summary, next_hook, created_at
           FROM persona_episodes WHERE user_id = ? ORDER BY id ASC`
        )
        .all(sourceUserId);
      const insertEpisode = targetDb.prepare(
        `INSERT INTO persona_episodes (user_id, persona_id, session_id, summary, next_hook, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const ep of episodes) {
        const mappedSessionId = ep.session_id != null ? (sessionIdMap.get(ep.session_id) ?? null) : null;
        insertEpisode.run(targetUserId, ep.persona_id, mappedSessionId, ep.summary, ep.next_hook, ep.created_at);
      }

      return {
        learner_profile: profiles.length,
        personas: personas.length,
        memory_facts: facts.length,
        learner_skill_memory: skills.length,
        vocabulary: vocab.length,
        curriculum_scenarios: scenarios.length,
        sessions: sessions.length,
        persona_episodes: episodes.length,
      };
    });

    const counts = importTx();
    console.log(`Imported learning data from user ${sourceUserId} -> target user ${targetUserId}:`);
    console.table(counts);
  } finally {
    sourceDb.close();
    targetDb.close();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
