import type { GroupMode } from '../types';

export function groupModeFromPersonCount(personCount: number): GroupMode {
  if (personCount >= 3) return 'Group';
  if (personCount === 2) return 'Pair';
  return 'Single';
}
