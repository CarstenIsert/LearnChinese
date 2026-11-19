export interface LearnerProfile {
  id: number;
  name: string;
  level: string;
  native_language: string;
  summary: string;
}

export interface Persona {
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
}

export interface MemoryFact {
  id: number;
  category: string;
  fact: string;
  source_persona_id: string | null;
  created_at: string;
}

export interface PersonaEpisode {
  id: number;
  persona_id: string;
  persona_name: string;
  summary: string;
  next_hook: string | null;
  created_at: string;
}

export interface LearnerSkill {
  id: number;
  skill_name: string;
  category: string;
  status: 'struggling' | 'practicing' | 'comfortable';
  notes_de: string;
  last_example: string | null;
  updated_at: string;
}

export interface VocabularyWord {
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
}

export interface CurriculumScenario {
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
  mastery_score: number;
  times_practiced: number;
  last_practiced_at: string | null;
}

export interface RecentSession {
  id: number;
  persona_id: string;
  scenario_id: string | null;
  started_at: string;
  ended_at: string;
  summary_de: string | null;
  persona_name: string;
  persona_emoji: string;
}

export interface BootstrapData {
  hasApiKey: boolean;
  liveModel: string;
  profile: LearnerProfile;
  personas: Persona[];
  scenarios: CurriculumScenario[];
  memoryFacts: MemoryFact[];
  recentEpisodes: PersonaEpisode[];
  skills: LearnerSkill[];
  dueVocabulary: VocabularyWord[];
  allVocabulary: VocabularyWord[];
  recentSessions: RecentSession[];
}

export interface TranscriptTurn {
  speaker: 'user' | 'ai';
  text: string;
}

export interface SessionReflection {
  summary_de: string;
  episode_summary_for_persona: string;
  next_hook_for_persona: string;
  new_facts: Array<{
    id?: number;
    category: string;
    fact: string;
  }>;
  coaching_tips: Array<{
    what_you_said: string;
    better_taiwan_mandarin: string;
    pinyin: string;
    explanation_de: string;
  }>;
  skill_updates: Array<{
    skill_name: string;
    category: string;
    status: 'struggling' | 'practicing' | 'comfortable';
    notes_de: string;
    last_example: string;
  }>;
  vocab_extracted: Array<{
    simplified_hanzi: string;
    pinyin: string;
    german: string;
    taiwan_note: string;
    example_hanzi: string;
    example_pinyin: string;
    example_de: string;
  }>;
  scenario_mastery_delta: number;
}
