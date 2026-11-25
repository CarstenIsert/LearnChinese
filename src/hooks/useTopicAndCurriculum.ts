import { useCallback, useEffect, useRef, useState } from 'react';
import { BootstrapData, CurriculumScenario } from '../types.ts';

const RANDOM_TOPIC_POOL = [
  'Erzähl von deinem heutigen Tag und frag nach dem Wetter.',
  'Pläne für das kommende Wochenende und Lieblingsessen.',
  'Reiseroute mit dem Zug oder Mietwagen planen.',
  'Im Restaurant bestellen und über Lieblingsgerichte sprechen.',
  'Über zukünftige Reisepläne und das Chinesischlernen plaudern.',
  'Unterschiede im Alltag, Essen und Wetter vergleichen.',
  'Auf dem Abendmarkt Getränke und Snacks bestellen.',
  'Über frühere Reisen und schöne Ausflugsziele sprechen.',
  'Einladung zum Tee und lockerer Smalltalk.',
  'Hobbys, Sport und wie man nach der Arbeit entspannt.',
];

interface UseTopicAndCurriculumParams {
  data: BootstrapData | null;
  selectedPersonaId: string;
  setData: React.Dispatch<React.SetStateAction<BootstrapData | null>>;
  setSelectedScenarioId: React.Dispatch<React.SetStateAction<string>>;
  showToast: (message: string, durationMs?: number) => void;
}

export function useTopicAndCurriculum({
  data,
  selectedPersonaId,
  setData,
  setSelectedScenarioId,
  showToast,
}: UseTopicAndCurriculumParams) {
  const [suggestedTopic, setSuggestedTopic] = useState<string>(() => {
    return RANDOM_TOPIC_POOL[Math.floor(Math.random() * RANDOM_TOPIC_POOL.length)];
  });
  const [isShufflingTopic, setIsShufflingTopic] = useState<boolean>(false);
  const recentTopicsRef = useRef<string[]>([]);
  const shuffleAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      shuffleAbortRef.current?.abort();
    };
  }, []);

  const cancelPendingTopicFetch = useCallback(() => {
    shuffleAbortRef.current?.abort();
    shuffleAbortRef.current = null;
    setIsShufflingTopic(false);
  }, []);

  const shuffleTopic = useCallback(async () => {
    setSelectedScenarioId('');
    shuffleAbortRef.current?.abort();
    const controller = new AbortController();
    shuffleAbortRef.current = controller;

    const pool = [...RANDOM_TOPIC_POOL];
    if (data?.personas) {
      for (const p of data.personas) {
        if (p.initial_hook) pool.push(p.initial_hook);
      }
    }
    if (data?.recentEpisodes) {
      for (const ep of data.recentEpisodes) {
        if (ep.next_hook) pool.push(ep.next_hook);
      }
    }

    const candidates = pool.filter((t) => t !== suggestedTopic);
    const instantNext =
      candidates[Math.floor(Math.random() * candidates.length)] || RANDOM_TOPIC_POOL[0];
    setSuggestedTopic(instantNext);
    recentTopicsRef.current = [suggestedTopic, ...recentTopicsRef.current].slice(0, 8);

    setIsShufflingTopic(true);
    try {
      const res = await fetch('/api/topics/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          personaId: selectedPersonaId || undefined,
          recentTopics: recentTopicsRef.current,
        }),
      });
      if (res.ok && !controller.signal.aborted) {
        const json = (await res.json()) as { topic?: string };
        if (json.topic) {
          setSuggestedTopic(json.topic);
          recentTopicsRef.current = [json.topic, ...recentTopicsRef.current].slice(0, 8);
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        // Keep instant fallback topic
      }
    } finally {
      if (shuffleAbortRef.current === controller) {
        shuffleAbortRef.current = null;
        setIsShufflingTopic(false);
      }
    }
  }, [data, selectedPersonaId, setSelectedScenarioId, suggestedTopic]);

  const expandCurriculum = useCallback(
    async (targetLevel?: 'HSK 3' | 'HSK 4') => {
      try {
        const res = await fetch('/api/curriculum/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetLevel }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          added: CurriculumScenario | null;
          remainingCurated: number;
          scenarios: CurriculumScenario[];
        };
        setData((prev) =>
          prev
            ? {
                ...prev,
                scenarios: json.scenarios,
                curriculumMeta: { remainingCurated: json.remainingCurated },
              }
            : prev
        );
        if (json.added) {
          showToast(`Neues Thema freigeschaltet: ${json.added.title_de}`);
        } else {
          showToast('Keine weiteren neuen Themen verfügbar (API-Key prüfen).');
        }
      } catch {
        showToast('Fehler beim Erweitern des Curriculums.');
      }
    },
    [setData, showToast]
  );

  return {
    suggestedTopic,
    isShufflingTopic,
    shuffleTopic,
    cancelPendingTopicFetch,
    expandCurriculum,
  };
}
