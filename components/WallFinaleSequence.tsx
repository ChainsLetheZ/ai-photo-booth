import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ENERGY_CONFIG } from '../constants';
import {
  chooseFinalePhotos,
  DEFAULT_FINALE_TIMING,
  FINALE_CARD_COUNT,
  finaleCardWidthPx,
  finaleFrameAt,
  finaleTotalMs,
  layoutFinaleCards,
  type FinaleTiming,
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

export default function WallFinaleSequence({
  entries,
  active,
  tagline,
  startPositions = {},
  timing = DEFAULT_FINALE_TIMING,
}: {
  entries: WallEntry[];
  active: boolean;
  tagline: string;
  startPositions?: FinaleStartMap;
  timing?: FinaleTiming;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);

  const ordered = useMemo(
    () => [...entries].sort((left, right) => left.createdAt - right.createdAt),
    [entries],
  );
  const cards = useMemo(() => {
    const visible = ordered.flatMap((entry, index) =>
      startPositions[entry.id] ? [index] : [],
    );
    const sampled = chooseFinalePhotos(ordered.length);
    const indices = [
      ...visible,
      ...sampled.filter((index) => !visible.includes(index)),
    ].slice(0, Math.min(FINALE_CARD_COUNT, ordered.length));
    return layoutFinaleCards(indices).map((card) => {
      const entry = ordered[card.entryIndex];
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
  }, [ordered, startPositions]);
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

      const byIndex = new Map(frame.cards.map((card) => [card.entryIndex, card]));
      cards.forEach((layout, poolIndex) => {
        const card = cardRefs.current[poolIndex];
        const image = imageRefs.current[poolIndex];
        if (!card || !image) return;
        const state = byIndex.get(layout.entryIndex);
        const entry = ordered[layout.entryIndex];
        if (!state || !entry) {
          card.style.opacity = '0';
          return;
        }
        if (image.dataset.src !== entry.imageUrl) {
          image.src = entry.imageUrl;
          image.dataset.src = entry.imageUrl;
        }
        const xPx = state.xUnit * stageWidth;
        const yPx = state.yUnit * stageHeight;
        card.style.transform = `translate3d(calc(${xPx.toFixed(2)}px - 50%), calc(${yPx.toFixed(2)}px - 50%), 0) scale(${state.scale.toFixed(3)}) rotate(${state.rotationDeg.toFixed(2)}deg)`;
        card.style.opacity = state.opacity.toFixed(3);
        card.style.setProperty('--card-blur', `${state.blurPx.toFixed(2)}px`);
        card.style.setProperty('--card-glow', state.glow.toFixed(3));
        card.style.setProperty(
          '--card-energy',
          ENERGY_CONFIG[entry.primaryEnergy].accent,
        );
      });
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
  }, [active, cards, ordered, timing]);

  return (
    <div ref={rootRef} className={`finale-seq ${active ? 'is-running' : ''}`} aria-hidden="true">
      <div className="finale-seq-field" />
      <div className="finale-seq-pulse" />

      <div className="finale-seq-cards">
        {cards.map((layout, poolIndex) => (
          <div
            className="finale-seq-card"
            key={layout.entryIndex}
            ref={(node) => {
              cardRefs.current[poolIndex] = node;
            }}
          >
            <img
              alt=""
              ref={(node) => {
                imageRefs.current[poolIndex] = node;
              }}
            />
          </div>
        ))}
      </div>

      <div className="finale-seq-halo" />
      <div className="finale-seq-type">
        <h1>{tagline}</h1>
      </div>
    </div>
  );
}
