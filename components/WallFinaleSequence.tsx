import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ENERGY_CONFIG } from '../constants';
import {
  DEFAULT_FINALE_TIMING,
  FINALE_CARD_COUNT,
  finaleCardWidthPx,
  finaleFrameAt,
  finaleTotalMs,
  layoutFinaleCards,
  type FinaleTiming,
  type FinalePixelTarget,
} from '../services/wallFinaleSequence';
import type { PrimaryEnergy, WallEntry } from '../types';
import './wallFinaleSequence.css';

export { finaleTotalMs as WALL_FINALE_TOTAL_MS };

export interface FinaleStartPosition {
  xUnit: number;
  yUnit: number;
  scale: number;
}

export type FinaleStartMap = Record<string, FinaleStartPosition>;
const EMPTY_START_POSITIONS: FinaleStartMap = {};

/**
 * individual presence → collective convergence → AI perception → distilled
 * message.
 *
 * Visible portraits converge from their captured wall positions (with a
 * deterministic scatter only as fallback) into a grid, a sweep of
 * light crosses them once, they give up the frame together, and the sentence
 * resolves from a blur and holds. No card is ever re-cropped — `object-position`
 * is set once in CSS and every animated property here is transform, opacity or
 * blur, on a bounded pool of DOM nodes (never more than the card count).
 *
 * All timing and geometry live in `services/wallFinaleSequence.ts`; this file
 * only writes computed values to the DOM.
 */

const FIELD_ANCHORS: Record<PrimaryEnergy, [number, number]> = {
  Motion: [22, 34],
  Intelligence: [76, 28],
  Life: [30, 74],
  Impact: [72, 76],
};

// A lightly populated rehearsal still needs a readable collective mark. Each
// guest remains present at least once; only when the wall is sparse do their
// tiny image-pixels echo to complete the letterform.
const MIN_PIXEL_COUNT = FINALE_CARD_COUNT;

function fieldGradient(entries: WallEntry[]) {
  const energies = Object.keys(ENERGY_CONFIG) as PrimaryEnergy[];
  const counts = new Map<PrimaryEnergy, number>();
  entries.forEach((entry) =>
    counts.set(entry.primaryEnergy, (counts.get(entry.primaryEnergy) ?? 0) + 1),
  );
  const total = entries.length || 1;
  const layers = energies.map((energy) => {
    const share = entries.length ? (counts.get(energy) ?? 0) / total : 0.25;
    const [x, y] = FIELD_ANCHORS[energy];
    const radius = 22 + (0.2 + share * 0.8) * 46;
    return `radial-gradient(circle at ${x}% ${y}%, ${ENERGY_CONFIG[energy].color} 0%, transparent ${radius.toFixed(1)}%)`;
  });
  return `${layers.join(', ')}, linear-gradient(#050c12, #02070b)`;
}

function dominantAccent(entries: WallEntry[]) {
  if (entries.length === 0) return '#7bd5ef';
  const counts = new Map<PrimaryEnergy, number>();
  entries.forEach((entry) =>
    counts.set(entry.primaryEnergy, (counts.get(entry.primaryEnergy) ?? 0) + 1),
  );
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return ENERGY_CONFIG[top[0]].accent;
}

function taglineLines(tagline: string) {
  const copy = tagline.trim();
  return copy.length === 8 ? [copy.slice(0, 4), copy.slice(4)] : [copy];
}

/** Rasterise the two-line event theme into fixed positions for real photos. */
function rasteriseTagline(tagline: string, count: number): FinalePixelTarget[] {
  if (count <= 0 || typeof document === 'undefined') return [];
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  const lines = taglineLines(tagline);
  context.fillStyle = '#fff';
  context.font = '900 245px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line, index) => {
    context.fillText(line, 800, 450 + (index - (lines.length - 1) / 2) * 285);
  });
  const pixels = context.getImageData(0, 0, 1600, 900).data;
  const candidates: FinalePixelTarget[] = [];
  for (let y = 0; y < 900; y += 3) {
    for (let x = 0; x < 1600; x += 3) {
      if (pixels[(y * 1600 + x) * 4 + 3] > 96) {
        candidates.push({ xUnit: x / 1600, yUnit: y / 900 });
      }
    }
  }
  return Array.from({ length: count }, (_, index) =>
    candidates[Math.min(candidates.length - 1, Math.floor(((index + 0.5) / count) * candidates.length))],
  ).filter(Boolean);
}

export default function WallFinaleSequence({
  entries,
  active,
  tagline,
  startPositions = EMPTY_START_POSITIONS,
  timing = DEFAULT_FINALE_TIMING,
}: {
  entries: WallEntry[];
  active: boolean;
  tagline: string;
  startPositions?: FinaleStartMap;
  timing?: FinaleTiming;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mosaicRef = useRef<HTMLDivElement | null>(null);

  const ordered = useMemo(
    () => [...entries].sort((left, right) => left.createdAt - right.createdAt),
    [entries],
  );
  const particleEntries = useMemo(() => {
    if (ordered.length === 0) return [];
    const count = Math.max(MIN_PIXEL_COUNT, ordered.length);
    const slots = Array<WallEntry | undefined>(count).fill(undefined);
    const pixelColumns = Math.max(1, Math.round(Math.sqrt(count * (16 / 9))));
    const recent = ordered.slice(-Math.min(ordered.length, FINALE_CARD_COUNT));
    for (let index = 0; index < count; index += 1) {
      const column = index % pixelColumns;
      const row = Math.floor(index / pixelColumns);
      const left = column > 0 ? slots[index - 1] : undefined;
      const above = row > 0 ? slots[index - pixelColumns] : undefined;
      const candidates = recent.filter(
        (entry) => entry.id !== left?.id && entry.id !== above?.id,
      );
      if (candidates.length > 0) {
        slots[index] = candidates[(index * 11 + row * 5 + column * 7) % candidates.length];
      }
    }
    return slots;
  }, [ordered]);
  const pixelTargets = useMemo(
    () => rasteriseTagline(tagline, particleEntries.length),
    [particleEntries.length, tagline],
  );
  const cards = useMemo(() => {
    const indices = particleEntries.map((_, index) => index);
    return layoutFinaleCards(indices, pixelTargets).map((card) => {
      const entry = particleEntries[card.entryIndex];
      const start = entry ? startPositions[entry.id] : undefined;
      return start
        ? {
            ...card,
            startX: start.xUnit,
            startY: start.yUnit,
            startScale: start.scale,
          }
        : card;
    });
  }, [particleEntries, pixelTargets, startPositions]);
  const field = useMemo(() => fieldGradient(entries), [entries]);
  const accent = useMemo(() => dominantAccent(entries), [entries]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--finale-field', field);
    root.style.setProperty('--finale-accent', accent);
  }, [field, accent]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || cards.length === 0) return;
    const width = finaleCardWidthPx(
      root.clientWidth,
      root.clientHeight,
      cards.length,
    );
    root.style.setProperty('--finale-card-width', `${width.toFixed(2)}px`);
  }, [cards.length]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stageWidth = root.clientWidth || window.innerWidth;
    const stageHeight = root.clientHeight || window.innerHeight;

    const apply = (timeMs: number) => {
      const frame = finaleFrameAt(timeMs, cards, timing);
      root.style.setProperty('--field-opacity', frame.fieldOpacity.toFixed(3));
      root.style.setProperty('--field-heat', frame.fieldHeat.toFixed(3));
      root.style.setProperty(
        '--pulse-opacity',
        frame.pulseXUnit === null ? '0' : '1',
      );
      if (frame.pulseXUnit !== null) {
        root.style.setProperty('--pulse-x', `${(frame.pulseXUnit * 100).toFixed(2)}%`);
      }
      root.style.setProperty('--tagline-blur', `${frame.taglineBlurPx.toFixed(2)}px`);
      root.style.setProperty('--tagline-opacity', frame.taglineOpacity.toFixed(3));
      root.style.setProperty('--tagline-scale', frame.taglineScale.toFixed(4));
      root.style.setProperty('--halo-opacity', frame.haloOpacity.toFixed(3));
      root.style.setProperty('--flash-opacity', frame.flashOpacity.toFixed(3));
      const representative = frame.cards[0];
      root.style.setProperty('--mosaic-opacity', (representative?.opacity ?? 0).toFixed(3));
      root.style.setProperty('--kv-pixel-mix', (representative?.pixelMix ?? 0).toFixed(3));
      root.style.setProperty(
        '--kv-reveal-right',
        `${((1 - frame.kvRevealXUnit) * 100).toFixed(2)}%`,
      );
      const mosaic = mosaicRef.current;
      if (mosaic) {
        mosaic.style.transform = `matrix(${frame.cameraScale.toFixed(5)}, 0, 0, ${frame.cameraScale.toFixed(5)}, ${(frame.cameraXUnit * stageWidth).toFixed(2)}, ${(frame.cameraYUnit * stageHeight).toFixed(2)})`;
      }

    };

    if (!active) {
      apply(-1);
      return;
    }
    const runMs = finaleTotalMs(timing);

    const startedAt = performance.now();
    let frameId = requestAnimationFrame(function tick(now) {
      const elapsed = now - startedAt;
      apply(elapsed);
      if (elapsed < runMs) {
        frameId = requestAnimationFrame(tick);
      } else {
        // Land exactly on the final frame rather than wherever the last tick
        // happened to fall, so the sentence always holds fully resolved.
        apply(runMs);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [active, cards, particleEntries, timing]);

  return (
    <div ref={rootRef} className={`finale-seq ${active ? 'is-running' : ''}`} aria-hidden="true">
      <div className="finale-seq-field" />
      <div className="finale-seq-pulse" />

      <div ref={mosaicRef} className="finale-seq-cards">
        {cards.map((layout) => {
          const entry = particleEntries[layout.entryIndex];
          return (
          <div
            className="finale-seq-card"
            key={layout.entryIndex}
            style={
              {
                left: `${(layout.targetX * 100).toFixed(4)}%`,
                top: `${(layout.targetY * 100).toFixed(4)}%`,
                '--kv-pixel-color': layout.targetColor ?? 'transparent',
              } as React.CSSProperties
            }
          >
            {entry?.sourceImageUrl && <img alt="" src={entry.sourceImageUrl} />}
          </div>
          );
        })}
      </div>

      <div className="finale-seq-halo" />
      <h1 className="sr-only">{taglineLines(tagline).join('\n')}</h1>
    </div>
  );
}
