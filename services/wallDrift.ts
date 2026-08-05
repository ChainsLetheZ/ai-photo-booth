import { wallConfig } from '../config/wallConfig';

export interface DriftPlacement {
  /** Centre of the tile, normalised to the layout box. */
  x: number;
  y: number;
  periodMs: number;
  delayMs: number;
}

/** Stable 0–1 value per entry so a tile keeps its drift across re-renders. */
export function hashUnit(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Where a photo floats while the wall is idle.
 *
 * A golden-angle spiral keeps the field evenly spread at any count — with six
 * photos in the room it still looks scattered rather than clumped at the
 * centre — and the hash only jitters it, so the position stays put between
 * renders instead of twitching.
 */
export function driftPlacement(
  id: string,
  index: number,
  total: number,
  spread: number = wallConfig.drift.spread,
): DriftPlacement {
  const unit = hashUnit(id);
  const count = Math.max(1, total);
  const angle = index * GOLDEN_ANGLE + unit * 1.4;
  const radius = Math.sqrt((index + 0.5) / count) * spread;
  const jitter = (unit - 0.5) * 0.05;
  const { periodMsMin, periodMsMax } = wallConfig.drift;
  const periodMs = periodMsMin + unit * (periodMsMax - periodMsMin);
  return {
    x: clampUnit(0.5 + Math.cos(angle) * radius + jitter),
    y: clampUnit(0.5 + Math.sin(angle) * radius * 0.78 + jitter),
    periodMs,
    delayMs: -unit * periodMs,
  };
}

function clampUnit(value: number) {
  return Math.max(0.06, Math.min(0.94, value));
}
