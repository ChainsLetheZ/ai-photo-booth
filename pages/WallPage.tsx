import React, { useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../components/BrandBar';
import { wallConfig } from '../config/wallConfig';
import {
  listWallEntries,
  subscribeToWallEntries,
} from '../services/portraitStore';
import type { WallEntry } from '../types';

function upsert(records: WallEntry[], entry: WallEntry) {
  return [...records.filter((item) => item.id !== entry.id), entry]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-wallConfig.capacity);
}

const { columns, rows, cellWidthPx, cellHeightPx, cellGapPx } =
  wallConfig.layout;
const columnPitch = cellWidthPx * 0.75 + cellGapPx;
const columnOffset = (cellHeightPx + cellGapPx) / 2;
const layoutWidth = (columns - 1) * columnPitch + cellWidthPx;
const layoutHeight =
  rows * (cellHeightPx + cellGapPx) - cellGapPx + columnOffset;

function chooseStandbySlots() {
  const count =
    wallConfig.layout.standbyGlowMinSlots +
    Math.floor(
      Math.random() *
        (wallConfig.layout.standbyGlowMaxSlots -
          wallConfig.layout.standbyGlowMinSlots +
          1),
    );
  const selected = new Set<number>();
  while (selected.size < count) {
    selected.add(Math.floor(Math.random() * wallConfig.capacity));
  }
  return selected;
}

function entryMotion(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0) / 0xffffffff;
  const period =
    wallConfig.breathing.periodMsMin +
    normalized *
      (wallConfig.breathing.periodMsMax - wallConfig.breathing.periodMsMin);
  return {
    period,
    delay: -normalized * period,
  };
}

export default function WallPage() {
  const [records, setRecords] = useState<WallEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [layoutScale, setLayoutScale] = useState(1);
  const [standbySlots, setStandbySlots] = useState<Set<number>>(
    chooseStandbySlots,
  );
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    listWallEntries().then(setRecords);
    return subscribeToWallEntries(
      (entry) => setRecords((current) => upsert(current, entry)),
      setRecords,
      setConnected,
    );
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setStandbySlots(chooseStandbySlots()),
      wallConfig.layout.standbyGlowPeriodMs,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const updateScale = () => {
      const bounds = stage.getBoundingClientRect();
      setLayoutScale(
        Math.min(1, (bounds.width - 40) / layoutWidth, (bounds.height - 40) / layoutHeight),
      );
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const slots = useMemo(
    () =>
      Array.from({ length: wallConfig.capacity }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        return {
          index,
          shortCode: String(wallConfig.firstShortCode + index).padStart(3, '0'),
          x: column * columnPitch,
          y: row * (cellHeightPx + cellGapPx) +
            (column % 2) * columnOffset,
        };
      }),
    [],
  );
  const entriesByCode = useMemo(
    () => new Map(records.map((entry) => [entry.shortCode, entry])),
    [records],
  );

  return (
    <main className="wall-shell">
      <BrandBar wall />
      <section className="collective-stage wall-layout-review" ref={stageRef}>
        <header className="wall-stage-label">
          <span>COLLECTIVE WALL · LAYOUT REVIEW</span>
          <strong>200 PLACES · #101—#300</strong>
        </header>

        <div
          className="hex-wall-layout"
          aria-label="200-place Collective Wall grid"
          style={
            {
              width: `${layoutWidth}px`,
              height: `${layoutHeight}px`,
              '--wall-layout-scale': layoutScale,
              '--wall-placeholder-opacity': wallConfig.layout.placeholderOpacity,
            } as React.CSSProperties
          }
        >
          {slots.map((slot) => {
            const entry = entriesByCode.get(slot.shortCode);
            const motion = entry ? entryMotion(entry.id) : null;
            return (
              <div
                className={`hex-wall-slot ${entry ? 'is-filled' : 'is-empty'} ${
                  !entry && standbySlots.has(slot.index)
                    ? 'is-standby-glow'
                    : ''
                }`}
                key={slot.shortCode}
                aria-label={
                  entry
                    ? `Wall portrait ${slot.shortCode}`
                    : `Empty wall place ${slot.shortCode}`
                }
                style={
                  {
                    left: `${slot.x}px`,
                    top: `${slot.y}px`,
                    width: `${cellWidthPx}px`,
                    height: `${cellHeightPx}px`,
                    '--wall-standby-opacity':
                      wallConfig.layout.standbyGlowOpacity,
                    '--wall-standby-period': `${wallConfig.layout.standbyGlowPeriodMs}ms`,
                    '--wall-breath-amplitude': `${wallConfig.breathing.amplitudePx}px`,
                    '--wall-breath-scale': wallConfig.breathing.scaleAmplitude,
                    '--wall-breath-period': motion
                      ? `${motion.period.toFixed(0)}ms`
                      : undefined,
                    '--wall-breath-delay': motion
                      ? `${motion.delay.toFixed(0)}ms`
                      : undefined,
                  } as React.CSSProperties
                }
              >
                {entry && (
                  <img
                    className="hex-wall-photo"
                    src={entry.thumbUrl}
                    alt={`Collective portrait ${entry.shortCode}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="wall-layout-status">
          <span>
            <i className={connected ? 'status-dot' : 'status-dot muted'} />
            {connected ? 'LIVE LINK' : 'RECONNECTING'}
          </span>
          <span>{records.length.toString().padStart(3, '0')} / 200 STORED</span>
        </div>
      </section>
    </main>
  );
}
