import type { LearnerSkill } from './types.ts';

const FACT_CATEGORY_LABELS: Record<string, string> = {
  family: 'Familie',
  travel_plans: 'Reisepläne',
  germany_life: 'Alltag',
  daily_life: 'Alltag',
  preferences: 'Vorlieben',
  past_trips: 'Erfahrungen',
  general: 'Allgemein',
  personal: 'Persönlich',
  work: 'Beruf',
  hobbies: 'Hobbys',
  study: 'Lernen',
  learning: 'Lernen',
  health: 'Gesundheit',
  food: 'Essen',
  language: 'Sprache',
  culture: 'Kultur',
  other: 'Sonstiges',
};

/**
 * Translates stored memory fact categories into German UI labels.
 */
export function formatFactCategoryDe(category: string): string {
  const key = category.trim().toLowerCase();
  if (!key) return 'Allgemein';
  return FACT_CATEGORY_LABELS[key] ?? category;
}

/**
 * German labels and badge styles for learner grammar/skill statuses.
 */
export const SKILL_STATUS_META: Record<
  LearnerSkill['status'],
  { label: string; badgeClass: string }
> = {
  struggling: { label: 'Übungsbedarf', badgeClass: 'badge badge-amber' },
  practicing: { label: 'In Übung', badgeClass: 'badge badge-gold' },
  comfortable: { label: 'Sicher', badgeClass: 'badge badge-emerald' },
};
