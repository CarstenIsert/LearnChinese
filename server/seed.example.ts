export interface PersonaSeed {
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

export interface CurriculumScenarioSeed {
  id: string;
  stage_number: number;
  stage_title_de: string;
  title_de: string;
  title_hanzi: string;
  description_de: string;
  persona_id: string;
  target_grammar: string;
  suggested_vocab: string;
}

export interface SkillSeed {
  skill_name: string;
  category: string;
  status: 'struggling' | 'practicing' | 'comfortable';
  notes_de: string;
  last_example: string;
}

export interface SeedProfileData {
  learnerProfile: {
    name: string;
    level: string;
    nativeLanguage: string;
    summary: string;
  };
  memoryFacts: Array<{
    category: 'family' | 'travel_plans' | 'germany_life' | 'preferences' | 'past_trips';
    fact: string;
  }>;
  personas?: PersonaSeed[];
  scenarios?: CurriculumScenarioSeed[];
  initialSkills?: SkillSeed[];
}

/**
 * PUBLIC REPOSITORY GENERIC SEED
 * ------------------------------
 * This file contains ONLY generic, fictional placeholder data so the public repository
 * runs out-of-the-box for anyone cloning it.
 *
 * Private user data and custom family structures belong ONLY in `data/profile.local.json`
 * or `data/tutor.db`, both of which are excluded from Git via `.gitignore`.
 */
export const GENERIC_SEED_PROFILE: SeedProfileData = {
  learnerProfile: {
    name: 'Alex',
    level: 'HSK 3',
    nativeLanguage: 'German',
    summary:
      'German speaker at HSK 3 level practicing everyday spoken Mandarin conversation with German explanations when needed.',
  },
  memoryFacts: [
    {
      category: 'germany_life',
      fact: 'Learner speaks German as their native language and is practicing HSK 3 Mandarin.',
    },
    {
      category: 'travel_plans',
      fact: 'Interested in everyday conversations, travel, food, and culture.',
    },
  ],
};

export const GENERIC_PERSONAS: PersonaSeed[] = [
  {
    id: 'coach-lin',
    name_hanzi: '林老师',
    name_pinyin: 'Lín Lǎoshī',
    relationship_de: 'Sprachcoach (Chinesisch / Deutsch)',
    generation: 'Bilingual Tutor',
    age_group: 'Sprachcoach',
    voice_name: 'Fenrir',
    avatar_emoji: '🎓',
    personality_prompt:
      'You are 林老师 (Lín Lǎoshī), a friendly bilingual Mandarin and German language coach. You help the learner practice free conversation, review vocabulary, and clarify HSK 3/4 grammar using clear German explanations whenever needed.',
    speaking_style:
      'Clear, structured, encouraging Mandarin with crisp German explanations whenever a new word or grammar pattern comes up.',
    initial_hook:
      'Kurzes Warm-up auf Chinesisch über den heutigen Tag und gezieltes Wiederholen der fälligen Vokabeln.',
  },
  {
    id: 'host-mother',
    name_hanzi: '陈妈妈',
    name_pinyin: 'Chén Māmā',
    relationship_de: 'Gastmutter',
    generation: 'Older Generation',
    age_group: '~65 Jahre',
    voice_name: 'Kore',
    avatar_emoji: '👵🏻',
    personality_prompt:
      'You are 陈妈妈 (Chén Māmā), a warm and hospitable host mother. You enjoy talking about family life, daily routines, weather, and home-cooked food.',
    speaking_style:
      'Warm, caring Mandarin. Uses clear sentences suitable for HSK 3+ and frequently asks about food and well-being.',
    initial_hook:
      'Frag herzlich nach, wie der Tag war und ob der Lernende schon gegessen hat.',
  },
  {
    id: 'friend-azhe',
    name_hanzi: '阿哲',
    name_pinyin: 'Ā-Zhé',
    relationship_de: 'Guter Freund',
    generation: 'Peer Generation',
    age_group: '~40 Jahre',
    voice_name: 'Puck',
    avatar_emoji: '👨🏻',
    personality_prompt:
      'You are 阿哲 (Ā-Zhé), an easygoing friend who loves travel, trains, road trips, and local restaurants.',
    speaking_style:
      'Friendly, peer-to-peer casual Mandarin using everyday conversational vocabulary.',
    initial_hook:
      'Besprich Ideen für einen Wochenendausflug und gute Restaurants.',
  },
  {
    id: 'student-xiaoan',
    name_hanzi: '小安',
    name_pinyin: 'Xiǎo-Ān',
    relationship_de: 'Junge Studentin',
    generation: 'Younger Generation',
    age_group: '19 Jahre',
    voice_name: 'Aoede',
    avatar_emoji: '👧🏻',
    personality_prompt:
      'You are 小安 (Xiǎo-Ān), an upbeat university student who enjoys night markets, tea shops, music, and modern city life.',
    speaking_style:
      'Cheerful, upbeat everyday Mandarin kept accessible for an HSK 3+ learner.',
    initial_hook:
      'Plaudere über beliebte Snacks, Getränke und Freizeitaktivitäten.',
  },
];

export const GENERIC_CURRICULUM_SCENARIOS: CurriculumScenarioSeed[] = [
  {
    id: 'stage1-daily-greeting',
    stage_number: 1,
    stage_title_de: 'Stufe 1: Alltag & Begrüßung',
    title_de: '1.1 Ankunft & Alltagsgespräch',
    title_hanzi: '好久不见！聊一聊日常',
    description_de:
      'Begrüßung, Gespräch über die Reise, das Wetter und den Alltag.',
    persona_id: 'host-mother',
    target_grammar: '好久不见, 已经...了, 刚到, 觉得 / 习惯',
    suggested_vocab: '好久不见, 坐飞机, 累不累, 习惯, 时差',
  },
  {
    id: 'stage2-dinner-table',
    stage_number: 2,
    stage_title_de: 'Stufe 2: Essen & Gastfreundschaft',
    title_de: '2.1 Gemeinsames Essen & Höflich Ablehnen',
    title_hanzi: '聚餐：多吃一点！',
    description_de:
      'Lobe das Essen, frage nach Gerichten und lerne höflich zu sagen, dass du schon satt bist.',
    persona_id: 'host-mother',
    target_grammar: '吃饱了, 尝尝看, 味道怎么样',
    suggested_vocab: '吃饱了, 客气, 味道, 招牌菜, 真的很好吃',
  },
  {
    id: 'stage3-travel-planning',
    stage_number: 3,
    stage_title_de: 'Stufe 3: Reisen & Unterwegs',
    title_de: '3.1 Eine Reiseroute planen',
    title_hanzi: '规划旅行路线',
    description_de:
      'Plane mit einem Freund einen Ausflug mit dem Zug oder Mietwagen.',
    persona_id: 'friend-azhe',
    target_grammar: '先...然后..., 坐高铁还是开车, 听说',
    suggested_vocab: '旅行, 高铁, 开车, 风景, 放假',
  },
  {
    id: 'stage4-street-food',
    stage_number: 4,
    stage_title_de: 'Stufe 4: Bestellen & Stadtleben',
    title_de: '4.1 Getränke & Snacks bestellen',
    title_hanzi: '逛夜市、买饮料',
    description_de:
      'Übe das Bestellen von Getränken (Zucker-/Eisgrad, Zum Mitnehmen) und moderne Alltagsausdrücke.',
    persona_id: 'student-xiaoan',
    target_grammar: '内用还是外带, 半糖少冰, 真的假的',
    suggested_vocab: '夜市, 珍珠奶茶, 微糖少冰, 外带, 捷运',
  },
  {
    id: 'stage5-free-coaching',
    stage_number: 5,
    stage_title_de: 'Stufe 5: Freies Sprechen & Vokabel-Training',
    title_de: '5.1 Freies Gespräch & Aktive Vokabel-Wiederholung',
    title_hanzi: '自由对话与词汇复习',
    description_de:
      'Offenes Gespräch mit deinem zweisprachigen Coach Lin Laoshi, um fällige Vokabeln und Grammatik zu festigen.',
    persona_id: 'coach-lin',
    target_grammar: 'Aktive Anwendung deiner fälligen SRS-Wörter & Korrektur von Satzstrukturen',
    suggested_vocab: 'Alle heute fälligen Vokabeln aus deiner SRS-Liste',
  },
];

export const INITIAL_DEFAULT_SKILLS: SkillSeed[] = [
  {
    skill_name: 'Vergangene Erfahrungen mit 过 (guò)',
    category: 'grammar',
    status: 'practicing',
    notes_de: 'Nützlich um über frühere Reisen und Erlebnisse zu sprechen.',
    last_example: '我已经去过几次了。',
  },
  {
    skill_name: 'Zukunftspläne mit 打算 (dǎsuàn) / 要 (yào)',
    category: 'grammar',
    status: 'practicing',
    notes_de: 'Wichtig für Gespräche über zukünftige Pläne und Reisen.',
    last_example: '我们明年打算去旅行。',
  },
];

export const INITIAL_DEFAULT_VOCAB = [
  {
    simplified_hanzi: '捷运',
    pinyin: 'jiéyùn',
    german: 'MRT / U-Bahn',
    taiwan_note: 'Häufiger Alltagsbegriff für die U-Bahn / MRT.',
    example_hanzi: '我们坐捷运去夜市吧，很快！',
    example_pinyin: 'Wǒmen zuò jiéyùn qù yèshì ba, hěn kuài!',
    example_de: 'Fahren wir mit der MRT zum Nachtmarkt, das geht schnell!',
  },
  {
    simplified_hanzi: '外带',
    pinyin: 'wàidài',
    german: 'zum Mitnehmen (Take-away; Gegenteil: 内用 nèiyòng)',
    taiwan_note: 'Standardfrage im Restaurant: 内用还是外带？',
    example_hanzi: '请问你要内用还是外带？',
    example_pinyin: 'Qǐngwèn nǐ yào nèiyòng háishì wàidài?',
    example_de: 'Möchten Sie hier essen oder zum Mitnehmen?',
  },
  {
    simplified_hanzi: '微糖少冰',
    pinyin: 'wēitáng shǎobīng',
    german: 'wenig Zucker, wenig Eis (beim Getränke bestellen)',
    taiwan_note: 'Nützlich beim Bestellen von Tee-Getränken.',
    example_hanzi: '我要一杯珍珠奶茶，微糖少冰。',
    example_pinyin: 'Wǒ yào yì bēi zhēnzhū nǎichá, wēitáng shǎobīng.',
    example_de: 'Ich hätte gern einen Bubble Tea mit wenig Zucker und wenig Eis.',
  },
  {
    simplified_hanzi: '真的假的',
    pinyin: 'zhēnde jiǎde',
    german: 'Echt jetzt? / Wirklich?',
    taiwan_note: 'Sehr natürliche, interessierte Reaktion im Gespräch.',
    example_hanzi: '真的假的？那太好了！',
    example_pinyin: 'Zhēnde jiǎde? Nà tài hǎo le!',
    example_de: 'Echt jetzt? Das ist ja super!',
  },
  {
    simplified_hanzi: '吃饱了',
    pinyin: 'chībǎo le',
    german: 'Ich bin satt (höflich beim Essen)',
    taiwan_note: 'Wichtig, wenn dir beim Essen noch einmal nachgeschöpft wird.',
    example_hanzi: '谢谢，我已经吃饱了，菜真的很好吃！',
    example_pinyin: 'Xièxie, wǒ yǐjīng chībǎo le, cài zhēnde hěn hǎochī!',
    example_de: 'Danke, ich bin schon satt, das Essen war wirklich super lecker!',
  },
  {
    simplified_hanzi: '打算',
    pinyin: 'dǎsuàn',
    german: 'planen / vorhaben',
    taiwan_note: 'Sehr häufiges HSK-3 Wort für Vorhaben und Reisepläne.',
    example_hanzi: '你周末打算做什么？',
    example_pinyin: 'Nǐ zhōumò dǎsuàn zuò shénme?',
    example_de: 'Was hast du am Wochenende vor?',
  },
];
