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

export { finaleTotalMs as WALL_FINALE_TOTAL_MS };

export interface FinaleStartPosition {
  xUnit: number;
  yUnit: number;
  scale: number;
}

export type FinaleStartMap = Record<string, FinaleStartPosition>;
const EMPTY_START_POSITIONS: FinaleStartMap = {};
const assetBase = import.meta.env?.BASE_URL ?? '/';
const GALA_KV_URL = `${assetBase}kv/gala-dinner-kv.jpg`;

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

function taglineLines(tagline: string) {
  const copy = tagline.trim();
  return copy.length === 8 ? [`${copy.slice(0, 4)}  ${copy.slice(4)}`] : [copy];
}

/**
 * Rasterise the eight-character headline onto a fixed portrait-tile grid.
 * Each returned coordinate is one unique cell: photos can touch at their
 * edges, but can never stack on top of one another.
 */
function fallbackTaglineTargets(tagline: string): FinalePixelTarget[] {
  if (typeof document === 'undefined') return [];
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  const lines = taglineLines(tagline);
  context.fillStyle = '#fff';
  // Coordinates mirror the headline in the supplied 4724 × 1313 master KV.
  // Everything outside these glyphs remains the untouched master artwork.
  context.font = '900 128px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line) => context.fillText(line, 800, 188));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const columns = 220;
  // At the supplied KV's panoramic ratio, 41 rows make every cell match the
  // source photo's portrait aspect. That is what makes the final mosaic read
  // as one continuous, edge-to-edge sheet rather than a pile of cards.
  const rows = 56;
  const targets: FinalePixelTarget[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.floor(((column + 0.5) / columns) * canvas.width);
      const y = Math.floor(((row + 0.5) / rows) * canvas.height);
      if (pixels[(y * canvas.width + x) * 4 + 3] > 64) {
        targets.push({
          xUnit: (column + 0.5) / columns,
          yUnit: (row + 0.5) / rows,
        });
      }
    }
  }
  return targets;
}

/** Read the headline directly from the supplied KV, so the photo glyphs and
 * the final artwork share exactly the same position and proportions. */
async function rasteriseKvHeadline(tagline: string): Promise<FinalePixelTarget[]> {
  if (typeof document === 'undefined') return [];
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error('Unable to read gala KV'));
    node.src = GALA_KV_URL;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1760;
  canvas.height = 490;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return fallbackTaglineTargets(tagline);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const columns = 220;
  const rows = 56;
  const targets: FinalePixelTarget[] = [];
  const cellWidth = canvas.width / columns;
  const cellHeight = canvas.height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor(column * cellWidth);
      const x1 = Math.ceil((column + 1) * cellWidth);
      const y0 = Math.floor(row * cellHeight);
      const y1 = Math.ceil((row + 1) * cellHeight);
      let headlinePixels = 0;
      let samples = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          samples += 1;
          // Only the warm white/peach Chinese headline, restricted to its
          // known top-centre band. Stars and the blue/orange light trails are
          // therefore never mistaken for a letter tile.
          if (x / canvas.width < 0.27 || x / canvas.width > 0.73 || y / canvas.height < 0.12 || y / canvas.height > 0.36) continue;
          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          if (red > 185 && green > 135 && blue > 105 && red >= blue) headlinePixels += 1;
        }
      }
      if (headlinePixels / Math.max(1, samples) >= 0.1) {
        targets.push({ xUnit: (column + 0.5) / columns, yUnit: (row + 0.5) / rows });
      }
    }
  }
  return targets.length > 80 ? targets : fallbackTaglineTargets(tagline);
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
  const [pixelTargets, setPixelTargets] = useState<FinalePixelTarget[]>(() =>
    fallbackTaglineTargets(tagline),
  );

  const ordered = useMemo(
    () => [...entries].sort((left, right) => left.createdAt - right.createdAt),
    [entries],
  );
  useEffect(() => {
    let cancelled = false;
    rasteriseKvHeadline(tagline).then((targets) => {
      if (!cancelled) setPixelTargets(targets);
    });
    return () => { cancelled = true; };
  }, [tagline]);
  const particleEntries = useMemo(() => {
    if (ordered.length === 0) return [];
    const count = pixelTargets.length;
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
  }, [ordered, pixelTargets.length]);
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
        Array.from(mosaic.children).forEach((node, index) => {
          const card = frame.cards[index];
          if (!card) return;
          const element = node as HTMLElement;
          element.style.left = `${(card.xUnit * 100).toFixed(4)}%`;
          element.style.top = `${(card.yUnit * 100).toFixed(4)}%`;
          element.style.opacity = card.opacity.toFixed(3);
          element.style.transform = `translate3d(-50%, -50%, 0) scale(${card.scale.toFixed(4)})`;
        });
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
      <img className="finale-seq-kv" src={GALA_KV_URL} alt="" />
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
