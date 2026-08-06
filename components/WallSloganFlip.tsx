import React, { useEffect, useMemo, useRef } from 'react';
import { ENERGY_CONFIG, EVENT_SLOGAN } from '../constants';
import {
  chooseFlipIndices,
  DEFAULT_TIMING,
  FLIP_COUNT,
  flipFrameAt,
  POOL_SIZE,
  scheduleFlips,
  SLOGAN_FLIP_TOTAL_MS,
  totalMs,
  type FlipTiming,
} from '../services/sloganFlip';
import type { PrimaryEnergy, WallEntry } from '../types';
import './wallSloganFlip.css';

export { SLOGAN_FLIP_TOTAL_MS };

/**
 * Movement four of the finale.
 *
 * The wall has already fused every portrait into one horizontal line. That line
 * is the spine of a book: portraits turn over it, faster and faster, and the
 * page that does not turn away becomes the statement.
 *
 * The photos are not the material the sentence is made of — the earlier version
 * tried that and lost, because CJK strokes are finer than any tile large enough
 * to carry a face. Here the portraits deliver the sentence and leave.
 *
 * All timing lives in `services/sloganFlip.ts`; this file only writes it to the
 * DOM, and only to `transform`, `opacity` and custom properties.
 */

const FIELD_ANCHORS: Record<PrimaryEnergy, [number, number]> = {
  Motion: [22, 34],
  Intelligence: [76, 28],
  Life: [30, 74],
  Impact: [72, 76],
};

/** Four coloured blobs sized by how much of the room each energy accounts for. */
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
    // Every energy keeps a floor so a single-energy room still gets a field
    // with depth in it rather than one flat wash.
    const radius = 24 + (0.18 + share * 0.82) * 54;
    return `radial-gradient(circle at ${x}% ${y}%, ${ENERGY_CONFIG[energy].color} 0%, transparent ${radius.toFixed(1)}%)`;
  });
  return `${layers.join(', ')}, linear-gradient(#050c12, #02070b)`;
}

/** The fused line itself: every portrait's energy, left to right, in order. */
function spineGradient(entries: WallEntry[]) {
  if (entries.length === 0) return 'linear-gradient(90deg, #7bd5ef, #7bd5ef)';
  if (entries.length === 1) {
    const only = ENERGY_CONFIG[entries[0].primaryEnergy].accent;
    return `linear-gradient(90deg, ${only}, ${only})`;
  }
  const stops = entries.map((entry, index) => {
    const position = (index / (entries.length - 1)) * 100;
    return `${ENERGY_CONFIG[entry.primaryEnergy].accent} ${position.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export default function WallSloganFlip({
  entries,
  active,
  slogan = EVENT_SLOGAN,
  pageCount = FLIP_COUNT,
  timing = DEFAULT_TIMING,
}: {
  entries: WallEntry[];
  active: boolean;
  slogan?: { primary: string; secondary: string };
  pageCount?: number;
  timing?: FlipTiming;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);

  const flips = useMemo(
    () => scheduleFlips(chooseFlipIndices(entries.length, pageCount), timing),
    [entries.length, pageCount, timing],
  );
  const field = useMemo(() => fieldGradient(entries), [entries]);
  const spine = useMemo(() => spineGradient(entries), [entries]);
  const spineGlow = useMemo(
    () =>
      entries.length
        ? ENERGY_CONFIG[entries[entries.length - 1].primaryEnergy].accent
        : '#7bd5ef',
    [entries],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const runMs = totalMs(timing);
    const apply = (timeMs: number) => {
      const frame = flipFrameAt(timeMs, flips, timing);
      root.style.setProperty('--camera-scale', frame.cameraScale.toFixed(4));
      root.style.setProperty('--camera-roll', `${frame.cameraRollDeg.toFixed(2)}deg`);
      root.style.setProperty('--spine-scale', frame.spineScale.toFixed(3));
      root.style.setProperty('--spine-opacity', frame.spineOpacity.toFixed(3));
      root.style.setProperty('--flip-heat', frame.heat.toFixed(3));
      root.style.setProperty('--flip-lift', frame.lift.toFixed(3));
      root.style.setProperty('--flip-vignette', frame.vignette.toFixed(3));
      root.style.setProperty('--flip-flash', frame.flash.toFixed(3));
      root.style.setProperty('--type-opacity', frame.typeOpacity.toFixed(3));
      root.style.setProperty('--type-scale', frame.typeScale.toFixed(4));
      root.style.setProperty('--sweep-x', `${frame.sweepXPercent.toFixed(1)}%`);
      root.style.setProperty('--sweep-opacity', frame.sweepOpacity.toFixed(3));

      cardRefs.current.forEach((card, slot) => {
        const image = imageRefs.current[slot];
        if (!card || !image) return;
        const state = frame.cards.get(slot);
        if (!state) {
          card.style.opacity = '0';
          return;
        }
        const entry = entries[state.entryIndex];
        if (!entry) {
          card.style.opacity = '0';
          return;
        }
        if (image.dataset.src !== entry.imageUrl) {
          image.src = entry.imageUrl;
          image.dataset.src = entry.imageUrl;
        }
        card.style.transform = `translate3d(${state.offsetXPercent.toFixed(2)}%, 0, ${state.depthPx.toFixed(1)}px) rotateX(${state.angleDeg.toFixed(2)}deg) rotateZ(${state.rollDeg.toFixed(2)}deg) scale(${state.scale.toFixed(3)})`;
        card.style.opacity = state.opacity.toFixed(3);
        card.style.setProperty('--card-rim', state.rim.toFixed(3));
        card.style.setProperty('--card-blur', `${state.blurPx.toFixed(2)}px`);
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
  }, [active, flips, entries, timing]);

  return (
    <div
      ref={rootRef}
      className={`slogan-flip ${active ? 'is-running' : ''}`}
      style={
        {
          '--flip-field': field,
          '--flip-spine': spine,
          '--flip-spine-glow': spineGlow,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className="slogan-flip-field" />

      <div className="slogan-flip-camera">
        <div className="slogan-flip-stage">
          {Array.from({ length: POOL_SIZE }, (_, slot) => (
            <div
              className="slogan-flip-card"
              key={slot}
              ref={(node) => {
                cardRefs.current[slot] = node;
              }}
            >
              <img
                alt=""
                ref={(node) => {
                  imageRefs.current[slot] = node;
                }}
              />
            </div>
          ))}
        </div>
        <div className="slogan-flip-spine" />
      </div>

      <div className="slogan-flip-vignette" />
      <div className="slogan-flip-flash" />

      <div className="slogan-flip-type">
        <h1>{slogan.primary}</h1>
        {slogan.secondary && <p>{slogan.secondary}</p>}
        <div className="slogan-flip-sweep" />
      </div>
    </div>
  );
}
