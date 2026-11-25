# AGENTS.md — Learn Chinese

## 🚨 CRITICAL PRIVACY & PUBLIC REPOSITORY RULES

This repository is hosted in a **public GitHub repository**.
All AI coding assistants and contributors MUST follow these rules strictly:

1. **NEVER commit personal user data, family names/details, transcripts, vocabulary databases, or API keys to Git.**
2. **All runtime data and personal profile seeds MUST reside inside `data/`** (specifically `data/tutor.db` and `data/profile.local.json`) or `.env` / `.env.local`, which are git-ignored.
3. **Committed seed files (`server/seed.example.ts`) MUST only contain generic, fictional placeholder data** so the public repository works out of the box for anyone without exposing the author's real family or personal life.
4. Before running `git add` or `git commit`, always verify `git status` and scan tracked files to ensure no personal names, `.db`, `.local.json`, or `.env` files are staged.

## Architecture Overview
- **Frontend:** React 19 + TypeScript + Vite (`src/`, default port `8888`)
  - Modular component & hook architecture (`src/components/HomeView.tsx`, `FreeTalkView.tsx`, `VocabularyView.tsx`, `ScenariosView.tsx`, `MemoryView.tsx`, `SessionRecapDialog.tsx`, `src/hooks/useTopicAndCurriculum.ts`).
  - Free-Talk-first Voice UI with current/seasonal topic suggestions, live pop-up vocabulary cards (Simplified Hanzi + Pinyin + German), and a blurred/toggleable live transcript.
  - Filterable HSK 3 & HSK 4 scenario curriculum with progressive automatic and on-demand expansion.
  - Uses native `<dialog>` elements (with `closedby="any"` and light-dismiss fallback) and semantic `lang` attributes (`de`, `zh-Hans`).
- **Backend:** Node.js + Express + WebSocket proxy (`server/`, default port `6889`)
  - Keeps `GEMINI_API_KEY` strictly on the server (loaded from `.env`).
  - Proxies low-latency bidirectional PCM audio (16kHz input, 24kHz output) and live tool calls (`save_vocab`, `record_vocab_review`, `remember_fact`) to the Gemini Multimodal Live API (`gemini-3.8-live`) via `@google/genai`.
  - Provides current/seasonal topic generation (`POST /api/topics/suggest`) and progressive HSK 3 & HSK 4 curriculum expansion (`POST /api/curriculum/expand`) via `server/curriculum.ts`.
  - Runs a bounded session-start memory selection pipeline (`server/memory.ts`) combining `core` facts, recent facts/episodes, semantically relevant older memories (`gemini-embedding-001`, 256-dim vectors stored in SQLite), and spaced-recall "throwback" memories (`last_referenced_at`).
  - Runs a Post-Session Reflection pipeline (`gemini-3.8-flash`) after each call to extract/consolidate semantic facts (`new_facts` with `core`/`episodic` tiers, `updated_facts`, `archived_fact_ids`), episodic relationship hooks, grammar/skill observations, SRS vocabulary review updates, automatic curriculum progression, and background embedding backfill.
- **Database:** Local SQLite (`better-sqlite3`) stored at `data/tutor.db`.

## Server Deployment & Data Migration
- **SSH Access:** `ssh myhetzner` (logs in as `carsten`).
- **Server Repository & Docker:** Checked out at `~/LearnChinese` and running via `docker compose` (`docker-compose.yml`, container name `learnchinese-app`, mounting `./data:/app/data`).
- **Migrating Learning Data (Local -> Server):**
  1. Create a clean, WAL-checkpointed backup of the local SQLite database:
     ```bash
     sqlite3 data/tutor.db ".backup /tmp/local_tutor_export.db"
     ```
  2. Copy the export and `scripts/import-learning-data.mjs` to the server and into the container, then run the import:
     ```bash
     scp /tmp/local_tutor_export.db scripts/import-learning-data.mjs myhetzner:/tmp/
     ssh myhetzner "docker cp /tmp/local_tutor_export.db learnchinese-app:/tmp/local_tutor_export.db && docker cp /tmp/import-learning-data.mjs learnchinese-app:/tmp/import-learning-data.mjs && docker exec learnchinese-app node /tmp/import-learning-data.mjs --source /tmp/local_tutor_export.db --target /app/data/tutor.db && docker exec learnchinese-app rm -f /tmp/local_tutor_export.db /tmp/import-learning-data.mjs && rm -f /tmp/local_tutor_export.db /tmp/import-learning-data.mjs && cd ~/LearnChinese && docker compose restart app"
     ```
  - `scripts/import-learning-data.mjs` creates a timestamped backup of `/app/data/tutor.db` before importing, preserves the server's `users`, `auth_sessions`, and `invite_codes` tables, and replaces only the learning data (`learner_profile`, `personas`, `memory_facts`, `learner_skill_memory`, `vocabulary`, `curriculum_scenarios`, `sessions`, and `persona_episodes`) for the target user.
