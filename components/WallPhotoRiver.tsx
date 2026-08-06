import React, { useMemo } from 'react';
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
}: {
  entries: WallEntry[];
  active: boolean;
}) {
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
      <div className={`wall-river-pan ${active ? 'is-panning' : ''}`}>
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
                style={
                  {
                    left: `${(tile.column * 100) / columns}%`,
                    top: `${(tile.row * 100) / rows}%`,
                    width: `${100 / columns}%`,
                    height: `${100 / rows}%`,
                    '--wall-energy':
                      ENERGY_CONFIG[tile.entry.primaryEnergy].accent,
                  } as React.CSSProperties
                }
              >
                <img src={tile.entry.imageUrl} alt="" draggable={false} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
