# Learn Chinese (HSK 3+ Voice Conversation Coach)

A voice-first Chinese language learning web app powered by the **Google Gemini Multimodal Live API (`gemini-3.8-live`)**. It helps you practice free speaking and listening in natural everyday Mandarin with **German** explanations when you get stuck, **Simplified Chinese characters (简体字) + Pinyin** flashcards, and a persistent **4-Pillar Memory & Spaced Repetition (SRS)** engine.

---

## 🔒 Privacy & Public Repository Rules (IMPORTANT)

This project is hosted in a **public GitHub repository**. To keep personal details, family configurations, conversation transcripts, and API keys completely private:

1. **Zero Personal Data in Git:** All personal facts, custom conversation partners, conversation transcripts, and the SQLite database live strictly inside the git-ignored `data/` folder (`data/tutor.db` and `data/profile.local.json`) and `.env`.
2. **Generic Public Seed (`server/seed.example.ts`):** The code committed to Git contains only generic placeholder data (`Alex`, generic conversation partners, and standard HSK 3 scenarios) so anyone cloning the repository can run it out of the box.
3. **Private Local Profile (`data/profile.local.json`):** On startup, if `data/profile.local.json` exists locally, the SQLite database initializes with your private learner profile, custom personas, scenarios, and memory facts. Neither `data/profile.local.json`, `data/tutor.db`, nor `.env` are tracked by Git.

---

## ✨ Key Features

* **Free-Talk First Voice UI:**
  * Clean audio call screen right at the top with a real-time voice visualizer.
  * **Multiple Conversation Partners & Voices:** Switch between different personas and Gemini Live voices (`Kore`, `Charon`, `Puck`, `Aoede`, `Fenrir`) with a single click.
  * **Current & Seasonal Topic Suggestions:** Automatically suggests fresh, timely conversation topics (combining current date/season, modern everyday topics, follow-up hooks from previous chats, and `gemini-3.8-flash` suggestions via `/api/topics/suggest`) with a one-click *"Aktuelles Thema"* button.
  * **Progressive HSK 3 & HSK 4 Curriculum:** Starts with core everyday scenarios and gradually expands with HSK 3 and HSK 4 topics (`server/curriculum.ts`)—both automatically as you practice and on-demand via *"HSK 3 erweitern"* / *"HSK 4 erweitern"* (including AI-generated follow-up scenarios once curated stages are unlocked).
  * **Live Pop-up Flashcards (简体 + Pinyin + Deutsch):** Whenever a word is explained in German or introduced during a call, `gemini-3.8-live` triggers `save_vocab` in real time to pop up a flashcard on screen.
  * **Blurred / Peekable Live Transcript:** Blurred by default so you train your ear rather than reading along, with a one-click *"Anzeigen / Ausblenden"* toggle.
* **4-Pillar Memory Layer (SQLite + `gemini-3.8-flash` Reflection):**
  1. **Semantic Fact Memory (`memory_facts`):** Shared across all conversation partners so they remember what you talked about in previous sessions.
  2. **Episodic Relationship Diary (`persona_episodes`):** Rolling summary of your past chats with each specific partner + a follow-up hook for your next conversation.
  3. **Linguistic & Grammar Skill Memory (`learner_skill_memory`):** Tracks HSK 3/4 structures you are practicing or struggling with.
  4. **Spaced Repetition (SRS) Vocabulary (`vocabulary`):** Tracks passive recognition vs. active spoken use and weaves due words into each conversation.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure `.env`
Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`:
```bash
cp .env.example .env
```

Default ports configured in `.env`:
* **Frontend (Vite):** `http://localhost:8888` (`FRONTEND_PORT=8888`)
* **Backend (Express + WebSocket):** `http://localhost:6889` (`PORT=6889`)

### 3. Start the app
```bash
npm run dev
```
Then open **[http://localhost:8888](http://localhost:8888)** in your browser, allow microphone access, and click **Free Talk starten**!
