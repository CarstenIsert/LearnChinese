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
  - Modular component architecture (`src/components/FreeTalkView.tsx`, `VocabularyView.tsx`, `ScenariosView.tsx`, `MemoryView.tsx`, `SessionRecapDialog.tsx`).
  - Free-Talk-first Voice UI with random topic suggestions, live pop-up vocabulary cards (Simplified Hanzi + Pinyin + German), and a blurred/toggleable live transcript.
  - Uses native `<dialog>` elements (with `closedby="any"` and light-dismiss fallback) and semantic `lang` attributes (`de`, `zh-Hans`).
- **Backend:** Node.js + Express + WebSocket proxy (`server/`, default port `6889`)
  - Keeps `GEMINI_API_KEY` strictly on the server (loaded from `.env`).
  - Proxies low-latency bidirectional PCM audio (16kHz input, 24kHz output) and live tool calls (`save_vocab`, `record_vocab_review`, `remember_fact`) to the Gemini Multimodal Live API (`gemini-3.8-live`) via `@google/genai`.
  - Runs a Post-Session Reflection pipeline (`gemini-3.8-flash`) after each call to extract new semantic facts, episodic relationship hooks, grammar/skill observations, and SRS vocabulary review updates.
- **Database:** Local SQLite (`better-sqlite3`) stored at `data/tutor.db`.
