import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { wallConfig } from '../config/wallConfig';
import { ENERGY_CONFIG } from '../constants';
import type { WallEntry } from '../types';

const { columns, rows, panSeconds, tileGapPx } = wallConfig.scroll;
const TILE_COUNT = columns * rows;

/**
 * The wall at rest: photos large enough to read across the room, drifting
 * diagonally without end.
 *
 * Four copies of the same field are laid out in a 2×2 block and the whole block
 * translates by exactly half its size, so the moment the loop restarts the
 * content under every pixel is identical and the seam is invisible. Photos
 * repeat to fill the field — here a tile is a face, not a place. Identity lives
 * in the hex register, which is a different formation.
 */
export default function WallPhotoRiver({
  entries,
  active,
  freeze = false,
}: {
  entries: WallEntry[];
  active: boolean;
  freeze?: boolean;
}) {
  const panRef = useRef<HTMLDivElement | null>(null);
  const freezeAnimationRef = useRef<Animation | null>(null);
  const tiles = useMemo(() => {
    if (entries.length === 0) return [];
    return Array.from({ length: TILE_COUNT }, (_, index) => {
      const entry = entries[index % entries.length];
      return {
        key: `${index}`,
        entry,
        column: index % columns,
        row: Math.floor(index / columns),
      };
    });
  }, [entries]);

  useLayoutEffect(() => {
    const pan = panRef.current;
    freezeAnimationRef.current?.cancel();
    freezeAnimationRef.current = null;
    if (!pan || !freeze) return;

    // Capture the composited position, then travel only a few more pixels with
    // a strong ease-out. The river brakes without snapping to its keyframe.
    const current = getComputedStyle(pan).transform;
    const matrix = new DOMMatrixReadOnly(current === 'none' ? undefined : current);
    const keyframes = [0, 0.25, 0.5, 0.75, 1].map((offset) => {
      // p(t) = 2t - t²: constant negative acceleration, landing at zero
      // velocity instead of relying on a browser-dependent easing curve.
      const progress = 2 * offset - offset * offset;
      return {
        offset,
        transform: new DOMMatrix([
          matrix.a,
          matrix.b,
          matrix.c,
          matrix.d,
          matrix.e - 2.2 * progress,
          matrix.f - 1.5 * progress,
        ]).toString(),
      };
    });
    const animation = pan.animate(
      keyframes,
      {
        duration: 700,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    freezeAnimationRef.current = animation;
    return () => {
      animation.cancel();
      if (freezeAnimationRef.current === animation) {
        freezeAnimationRef.current = null;
      }
    };
  }, [freeze]);

  if (tiles.length === 0) return null;

  return (
    <div
      className={`wall-river ${active ? 'is-active' : ''}`}
      aria-hidden="true"
      style={
        {
          '--river-pan': `${panSeconds}s`,
          '--river-gap': `${tileGapPx}px`,
          '--river-columns': columns,
          '--river-rows': rows,
          '--river-fade': `${wallConfig.scroll.fadeMs}ms`,
        } as React.CSSProperties
      }
    >
      <div
        ref={panRef}
        className={`wall-river-pan ${active || freeze ? 'is-panning' : ''}`}
      >
        {[0, 1, 2, 3].map((panel) => (
          <div
            className="wall-river-panel"
            key={panel}
            style={{
              left: panel % 2 === 0 ? '0%' : '50%',
              top: panel < 2 ? '0%' : '50%',
            }}
          >
            {tiles.map((tile) => (
              <div
                className="wall-river-tile"
                key={`${panel}-${tile.key}`}
                data-entry-id={tile.entry.id}
                style={
                  {
                    left: `${(tile.column * 100) / columns}%`,
                    top: `${(tile.row * 100) / rows}%`,
                    width: `${100 / columns}%`,
                    height: `${100 / rows}%`,
                    '--wall-energy':
                      ENERGY_CONFIG[tile.entry.primaryEnergy].accent,
                    '--river-offset-x': `${((Number(tile.key) % 5) - 2) * 7}px`,
                    '--river-rotation': `${((Number(tile.key) % 7) - 3) * 0.45}deg`,
                  } as React.CSSProperties
                }
              >
                <img
                  src={tile.entry.imageUrl}
                  alt=""
                  draggable={false}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
