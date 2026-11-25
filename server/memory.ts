import { getGeminiClient, isValidApiKey } from './services/geminiClient.ts';
import {
  DEFAULT_USER_ID,
  getActiveMemoryFactsWithEmbeddings,
  getPersonaEpisodesWithEmbeddings,
  MemoryFactWithEmbedding,
  PersonaEpisodeWithEmbedding,
  saveMemoryFactEmbedding,
  savePersonaEpisodeEmbedding,
  touchMemoryFactsReferenced,
  touchPersonaEpisodesReferenced,
} from './db.ts';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 256;

const CORE_FACTS_LIMIT = 10;
const RECENT_FACTS_LIMIT = 5;
const RELEVANT_FACTS_LIMIT = 4;
const THROWBACK_FACTS_LIMIT = 1;
const MIN_SIMILARITY_THRESHOLD = 0.35;

const MY_RECENT_EPISODES_LIMIT = 2;
const MY_EXTRA_EPISODES_LIMIT = 1;
const OTHER_RECENT_EPISODES_LIMIT = 2;
const OTHER_EXTRA_EPISODES_LIMIT = 1;

export interface SelectedMemoryContext {
  coreFacts: MemoryFactWithEmbedding[];
  recentFacts: MemoryFactWithEmbedding[];
  relevantOlderFacts: MemoryFactWithEmbedding[];
  throwbackFacts: MemoryFactWithEmbedding[];
  myRecentEpisodes: PersonaEpisodeWithEmbedding[];
  myOlderEpisodes: PersonaEpisodeWithEmbedding[];
  otherRecentEpisodes: PersonaEpisodeWithEmbedding[];
  otherOlderEpisodes: PersonaEpisodeWithEmbedding[];
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function generateEmbeddingsBatch(
  apiKey: string,
  texts: string[]
): Promise<Array<number[] | null>> {
  if (!isValidApiKey(apiKey) || texts.length === 0) {
    return texts.map(() => null);
  }
  try {
    const ai = getGeminiClient(apiKey);
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });
    const embeddings = response.embeddings ?? [];
    return texts.map((_, idx) => embeddings[idx]?.values ?? null);
  } catch (err) {
    console.warn('Embedding generation skipped:', err instanceof Error ? err.message : err);
    return texts.map(() => null);
  }
}

/**
 * Generates and stores embeddings for any active memory_facts or persona_episodes
 * that do not have one yet (bounded per call to avoid long delays).
 */
export async function ensureMissingEmbeddings(
  apiKey: string,
  userId = DEFAULT_USER_ID,
  maxPerTable = 25
): Promise<void> {
  if (!isValidApiKey(apiKey)) return;

  const missingFacts = getActiveMemoryFactsWithEmbeddings(userId)
    .filter((f) => !f.embedding)
    .slice(0, maxPerTable);

  if (missingFacts.length > 0) {
    const factTexts = missingFacts.map((f) => `[${f.category}] ${f.fact}`);
    const vectors = await generateEmbeddingsBatch(apiKey, factTexts);
    vectors.forEach((vec, idx) => {
      if (vec) {
        saveMemoryFactEmbedding(missingFacts[idx].id, JSON.stringify(vec), userId);
      }
    });
  }

  const missingEpisodes = getPersonaEpisodesWithEmbeddings(userId)
    .filter((ep) => !ep.embedding)
    .slice(0, maxPerTable);

  if (missingEpisodes.length > 0) {
    const epTexts = missingEpisodes.map(
      (ep) => `${ep.persona_name}: ${ep.summary}${ep.next_hook ? ` (${ep.next_hook})` : ''}`
    );
    const vectors = await generateEmbeddingsBatch(apiKey, epTexts);
    vectors.forEach((vec, idx) => {
      if (vec) {
        savePersonaEpisodeEmbedding(missingEpisodes[idx].id, JSON.stringify(vec), userId);
      }
    });
  }
}

function compareLeastRecentlyReferenced(
  a: { last_referenced_at: string | null; id: number },
  b: { last_referenced_at: string | null; id: number }
): number {
  if (!a.last_referenced_at && b.last_referenced_at) return -1;
  if (a.last_referenced_at && !b.last_referenced_at) return 1;
  if (a.last_referenced_at && b.last_referenced_at) {
    const cmp = a.last_referenced_at.localeCompare(b.last_referenced_at);
    if (cmp !== 0) return cmp;
  }
  return a.id - b.id;
}

function rankBySimilarity<T extends { embedding: string | null }>(
  items: T[],
  queryVector: number[] | null
): Array<{ item: T; score: number }> {
  if (!queryVector) return [];
  return items
    .map((item) => {
      const vec = parseEmbedding(item.embedding);
      const score = vec ? cosineSimilarity(queryVector, vec) : 0;
      return { item, score };
    })
    .filter((entry) => entry.score >= MIN_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/**
 * Selects a fixed-budget set of core, recent, semantically relevant, and spaced-recall
 * facts and episodes for a live conversation session.
 */
export async function selectSessionMemoryContext(params: {
  apiKey?: string;
  personaId: string;
  queryText?: string;
  userId?: number;
}): Promise<SelectedMemoryContext> {
  const { apiKey, personaId, queryText, userId = DEFAULT_USER_ID } = params;

  if (apiKey) {
    void ensureMissingEmbeddings(apiKey, userId, 20).catch((err) => {
      console.warn('Background embedding backfill skipped:', err instanceof Error ? err.message : err);
    });
  }

  const allFacts = getActiveMemoryFactsWithEmbeddings(userId);
  const allEpisodes = getPersonaEpisodesWithEmbeddings(userId);

  let queryVector: number[] | null = null;
  if (apiKey && queryText && queryText.trim()) {
    const [vec] = await generateEmbeddingsBatch(apiKey, [queryText.trim()]);
    queryVector = vec;
  }

  // 1. Core facts (capped)
  const coreFacts = allFacts
    .filter((f) => f.tier === 'core')
    .slice(0, CORE_FACTS_LIMIT);
  const pickedFactIds = new Set(coreFacts.map((f) => f.id));

  // 2. Most recent remaining facts
  const recentFacts = allFacts
    .filter((f) => !pickedFactIds.has(f.id))
    .slice(0, RECENT_FACTS_LIMIT);
  recentFacts.forEach((f) => pickedFactIds.add(f.id));

  // 3. Semantically relevant older facts
  const remainingFacts = allFacts.filter((f) => !pickedFactIds.has(f.id));
  const relevantOlderFacts = rankBySimilarity(remainingFacts, queryVector)
    .slice(0, RELEVANT_FACTS_LIMIT)
    .map((entry) => entry.item);
  relevantOlderFacts.forEach((f) => pickedFactIds.add(f.id));

  // 4. Spaced "throwback" fact (least recently referenced among remaining)
  const throwbackCandidates = allFacts
    .filter((f) => !pickedFactIds.has(f.id))
    .sort(compareLeastRecentlyReferenced);
  const throwbackFacts = throwbackCandidates.slice(0, THROWBACK_FACTS_LIMIT);
  throwbackFacts.forEach((f) => pickedFactIds.add(f.id));

  // 5. Episodes with current persona
  const myAll = allEpisodes.filter((ep) => ep.persona_id === personaId);
  const myRecentEpisodes = myAll.slice(0, MY_RECENT_EPISODES_LIMIT);
  const pickedEpIds = new Set(myRecentEpisodes.map((ep) => ep.id));

  const myRemaining = myAll.filter((ep) => !pickedEpIds.has(ep.id));
  let myOlderEpisodes = rankBySimilarity(myRemaining, queryVector)
    .slice(0, MY_EXTRA_EPISODES_LIMIT)
    .map((entry) => entry.item);
  if (myOlderEpisodes.length === 0 && myRemaining.length > 0) {
    myOlderEpisodes = [...myRemaining]
      .sort(compareLeastRecentlyReferenced)
      .slice(0, MY_EXTRA_EPISODES_LIMIT);
  }
  myOlderEpisodes.forEach((ep) => pickedEpIds.add(ep.id));

  // 6. Episodes with other personas
  const otherAll = allEpisodes.filter((ep) => ep.persona_id !== personaId);
  const otherRecentEpisodes = otherAll.slice(0, OTHER_RECENT_EPISODES_LIMIT);
  otherRecentEpisodes.forEach((ep) => pickedEpIds.add(ep.id));

  const otherRemaining = otherAll.filter((ep) => !pickedEpIds.has(ep.id));
  const otherOlderEpisodes = rankBySimilarity(otherRemaining, queryVector)
    .slice(0, OTHER_EXTRA_EPISODES_LIMIT)
    .map((entry) => entry.item);
  otherOlderEpisodes.forEach((ep) => pickedEpIds.add(ep.id));

  // Mark surfaced older/relevant memories as referenced so spaced recall rotates
  const factsToTouch = [...relevantOlderFacts, ...throwbackFacts].map((f) => f.id);
  const episodesToTouch = [...myOlderEpisodes, ...otherOlderEpisodes].map((ep) => ep.id);
  touchMemoryFactsReferenced(factsToTouch, userId);
  touchPersonaEpisodesReferenced(episodesToTouch, userId);

  return {
    coreFacts,
    recentFacts,
    relevantOlderFacts,
    throwbackFacts,
    myRecentEpisodes,
    myOlderEpisodes,
    otherRecentEpisodes,
    otherOlderEpisodes,
  };
}
