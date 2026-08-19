import React, { useEffect, useMemo, useRef } from 'react';
import { wallConfig } from '../config/wallConfig';
import { ENERGY_CONFIG } from '../constants';
import type { WallEntry } from '../types';

const { columns, rows, panSeconds, tileGapPx } = wallConfig.scroll;
const TILE_COUNT = columns * rows;
const wallRiverSoundtrackUrl =
  `${import.meta.env.BASE_URL}audio/wall-river-digital-clouds.mp3`;

/**
 * The wall at rest is a fixed, panoramic field. The camera never travels: each
 * photograph approaches from the lower-right foreground in its own beat, then
 * the complete field gently streams towards the upper-left.
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
  const soundtrackRef = useRef<HTMLAudioElement | null>(null);
  const soundtrackActive = active && !freeze;
  const tiles = useMemo(() => {
    if (entries.length === 0) return [];
    const recent = entries.slice(-TILE_COUNT);
    const placed: Array<WallEntry | undefined> = [];
    return Array.from({ length: TILE_COUNT }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = column > 0 ? placed[index - 1] : undefined;
      const above = row > 0 ? placed[index - columns] : undefined;
      const candidates = recent.filter(
        (entry) => entry.id !== left?.id && entry.id !== above?.id,
      );
      const entry = candidates.length
        ? candidates[(index * 7 + row * 3 + column * 5) % candidates.length]
        : undefined;
      placed.push(entry);
      return {
        key: `${index}-${entry?.id ?? 'empty'}`,
        entry,
        column,
        row,
      };
    });
  }, [entries]);

  useEffect(() => {
    const soundtrack = soundtrackRef.current;
    if (!soundtrack) return;
    soundtrack.volume = 0.18;
    if (soundtrackActive) {
      // Browsers permit this straight away on displays with media permission;
      // the gesture listeners below cover the first interaction everywhere else.
      void soundtrack.play().catch(() => undefined);
      return;
    }
    soundtrack.pause();
  }, [soundtrackActive]);

  useEffect(() => {
    const unlockSoundtrack = () => {
      if (!soundtrackActive) return;
      void soundtrackRef.current?.play().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlockSoundtrack);
    window.addEventListener('keydown', unlockSoundtrack);
    return () => {
      window.removeEventListener('pointerdown', unlockSoundtrack);
      window.removeEventListener('keydown', unlockSoundtrack);
    };
  }, [soundtrackActive]);

  if (tiles.length === 0) return null;

  return (
    <>
      <audio
        ref={soundtrackRef}
        src={wallRiverSoundtrackUrl}
        loop
        preload="auto"
        aria-hidden="true"
      />
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
        <div className={`wall-river-pan ${active || freeze ? 'is-panning' : ''}`}>
          <div className="wall-river-panel">
            {tiles.map((tile) => {
              // A deterministic, diagonal arrival sequence. It means a fresh
              // batch does not pop in together, while returning to the wall
              // gives every existing image the same readable formation.
              const layer = (tile.column * 5 + tile.row * 3) % 5;
              const enterDelay =
                tile.column * 460 + tile.row * 680 + layer * 360;
              const rowOffset = tile.column % 2 === 0 ? -10 : 0;
              return (
                <div
                className="wall-river-tile"
                key={tile.key}
                data-entry-id={tile.entry?.id}
                style={
                  {
                    left: `${(tile.column * 100) / columns}%`,
                    // Brick the photo strips vertically. Every column remains
                    // edge-to-edge with its own neighbours, but adjacent
                    // columns no longer read as a rigid spreadsheet.
                    top: `${(tile.row * 100) / rows + rowOffset}%`,
                    width: `${100 / columns}%`,
                    height: `${100 / rows}%`,
                    '--wall-energy':
                      tile.entry
                        ? ENERGY_CONFIG[tile.entry.primaryEnergy].accent
                        : undefined,
                    '--river-enter-delay': `${enterDelay}ms`,
                    '--river-layer': layer,
                    zIndex: layer + 1,
                  } as React.CSSProperties
                }
              >
                {tile.entry && (
                  <div className="wall-river-photo">
                    <img
                      src={tile.entry.sourceImageUrl ?? tile.entry.imageUrl}
                      alt=""
                      draggable={false}
                    />
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
