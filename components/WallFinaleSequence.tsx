import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const assetBase = import.meta.env?.BASE_URL ?? '/';

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

/** Samples the real 16:9 master KV into a photo-pixel mosaic. */
function rasteriseKv(source: string, count: number): Promise<FinalePixelTarget[]> {
  if (count <= 0 || typeof document === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const columns = Math.max(1, Math.round(Math.sqrt(count * (16 / 9))));
      const rows = Math.max(1, Math.ceil(count / columns));
      const canvas = document.createElement('canvas');
      canvas.width = columns;
      canvas.height = rows;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        resolve([]);
        return;
      }
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = columns / rows;
      let sx = 0;
      let sy = 0;
      let sw = image.naturalWidth;
      let sh = image.naturalHeight;
      if (sourceRatio > targetRatio) {
        sw = image.naturalHeight * targetRatio;
        sx = (image.naturalWidth - sw) / 2;
      } else {
        sh = image.naturalWidth / targetRatio;
        sy = (image.naturalHeight - sh) / 2;
      }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, columns, rows);
      const pixels = context.getImageData(0, 0, columns, rows).data;
      resolve(Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const offset = (row * columns + column) * 4;
        return {
          xUnit: (column + 0.5) / columns,
          yUnit: (row + 0.5) / rows,
          color: `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`,
        };
      }));
    };
    image.onerror = () => resolve([]);
    image.src = source;
  });
}

function fallbackKvGrid(count: number): FinalePixelTarget[] {
  if (count <= 0) return [];
  const columns = Math.max(1, Math.round(Math.sqrt(count * (16 / 9))));
  const rows = Math.max(1, Math.ceil(count / columns));
  return Array.from({ length: count }, (_, index) => ({
    xUnit: ((index % columns) + 0.5) / columns,
    yUnit: (Math.floor(index / columns) + 0.5) / rows,
  }));
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
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);
  const kvImageUrl = `${assetBase}kv/booth-kv.png`;
  const [sampledKvTargets, setSampledKvTargets] = useState<FinalePixelTarget[]>([]);

  const ordered = useMemo(
    () => [...entries].sort((left, right) => left.createdAt - right.createdAt),
    [entries],
  );
  const particleEntries = useMemo(() => {
    if (ordered.length === 0) return [];
    const count = Math.min(
      FINALE_CARD_COUNT,
      Math.max(MIN_PIXEL_COUNT, ordered.length),
    );
    return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]);
  }, [ordered]);
  useEffect(() => {
    let cancelled = false;
    rasteriseKv(kvImageUrl, particleEntries.length).then((targets) => {
      if (!cancelled) setSampledKvTargets(targets);
    });
    return () => {
      cancelled = true;
    };
  }, [kvImageUrl, particleEntries.length]);
  const pixelTargets = useMemo(() => {
    if (sampledKvTargets.length === particleEntries.length) return sampledKvTargets;
    return fallbackKvGrid(particleEntries.length);
  }, [particleEntries.length, sampledKvTargets]);
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

      const byIndex = new Map(frame.cards.map((card) => [card.entryIndex, card]));
      cards.forEach((layout, poolIndex) => {
        const card = cardRefs.current[poolIndex];
        const image = imageRefs.current[poolIndex];
        if (!card || !image) return;
        const state = byIndex.get(layout.entryIndex);
        const entry = particleEntries[layout.entryIndex];
        if (!state || !entry) {
          card.style.opacity = '0';
          return;
        }
        const imageUrl = entry.imageUrl;
        if (image.dataset.src !== imageUrl) {
          image.src = imageUrl;
          image.dataset.src = imageUrl;
        }
        const xPx = state.xUnit * stageWidth;
        const yPx = state.yUnit * stageHeight;
        card.style.transform = `translate3d(calc(${xPx.toFixed(2)}px - 50%), calc(${yPx.toFixed(2)}px - 50%), 0) scale(${state.scale.toFixed(3)}) rotate(${state.rotationDeg.toFixed(2)}deg)`;
        card.style.opacity = state.opacity.toFixed(3);
        card.style.setProperty('--card-blur', `${state.blurPx.toFixed(2)}px`);
        card.style.setProperty('--card-glow', state.glow.toFixed(3));
        card.style.setProperty('--kv-pixel-mix', state.pixelMix.toFixed(3));
        card.style.setProperty('--kv-pixel-color', layout.targetColor ?? 'transparent');
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
  }, [active, cards, particleEntries, timing]);

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
      <div className="finale-seq-flash" />
      <div className="finale-seq-type">
        <img src={kvImageUrl} alt="" />
        <h1 className="sr-only">{taglineLines(tagline).join('\n')}</h1>
      </div>
    </div>
  );
}
