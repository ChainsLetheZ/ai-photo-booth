import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WallSloganFlip from '../components/WallSloganFlip';
import {
  chooseFlipIndices,
  DEFAULT_TIMING,
  scheduleFlips,
  totalMs,
  type FlipTiming,
} from '../services/sloganFlip';
import { ENERGY_CONFIG, EVENT_SLOGAN } from '../constants';
import type { PrimaryEnergy, WallEntry } from '../types';

/**
 * Movement four in isolation, with the two dials that decide whether it reads
 * as a riffle or a slideshow. The wall's resting river is untouched by this
 * route — nothing here runs on the wall itself.
 */

const DENSITIES = [20, 28, 40, 56, 72];
const SPEEDS: { label: string; flipMs: number }[] = [
  { label: 'FAST', flipMs: 1500 },
  { label: 'QUICK', flipMs: 1900 },
  { label: 'DEFAULT', flipMs: 2200 },
  { label: 'SLOW', flipMs: 2800 },
];

const chip = (selected: boolean): React.CSSProperties => ({
  padding: '7px 13px',
  cursor: 'pointer',
  border: `1px solid ${selected ? '#7bd5ef' : 'rgba(123,213,239,.32)'}`,
  background: selected ? 'rgba(123,213,239,.18)' : 'transparent',
  color: selected ? '#fff' : '#7bd5ef',
  fontFamily: 'inherit',
  fontSize: 11,
  letterSpacing: 1.1,
});

export default function FlipPreviewPage() {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [pageCount, setPageCount] = useState(40);
  const [flipMs, setFlipMs] = useState(DEFAULT_TIMING.flipMs);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/wall/entries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((loaded: WallEntry[]) => setEntries(loaded))
      .catch(() => setError('Could not load wall entries.'));
  }, []);

  const timing = useMemo<FlipTiming>(
    () => ({ ...DEFAULT_TIMING, flipMs }),
    [flipMs],
  );

  const play = useCallback(() => {
    setRunning(false);
    window.setTimeout(() => setRunning(true), 60);
  }, []);

  // Replay whenever a dial moves, so the two settings can be felt back to back.
  useEffect(() => {
    if (entries.length === 0) return;
    play();
  }, [pageCount, flipMs, entries.length, play]);

  const stats = useMemo(() => {
    const flips = scheduleFlips(
      chooseFlipIndices(entries.length, pageCount),
      timing,
    );
    if (flips.length < 2) {
      return { pages: flips.length, perSecond: 0, firstGap: 0, lastGap: 0 };
    }
    const gaps = flips
      .slice(1)
      .map((flip, index) => flip.startMs - flips[index].startMs);
    return {
      pages: flips.length,
      perSecond: flips.length / (timing.flipMs / 1000),
      firstGap: gaps[0],
      lastGap: gaps[gaps.length - 1],
    };
  }, [entries.length, pageCount, timing]);

  const mix = (Object.keys(ENERGY_CONFIG) as PrimaryEnergy[]).map((energy) => ({
    energy,
    count: entries.filter((entry) => entry.primaryEnergy === energy).length,
  }));

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: '#02070b',
        color: '#dff8ff',
        fontFamily: 'Courier New, monospace',
        overflow: 'hidden',
      }}
    >
      <WallSloganFlip
        entries={entries}
        active={running}
        slogan={EVENT_SLOGAN}
        pageCount={pageCount}
        timing={timing}
      />

      <div
        style={{
          position: 'absolute',
          zIndex: 10,
          left: 22,
          right: 22,
          bottom: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'rgba(2,7,11,.72)',
          padding: '14px 16px',
          border: '1px solid rgba(123,213,239,.22)',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={play}
            style={{
              padding: '11px 20px',
              background: '#e2001a',
              color: '#fff',
              border: 0,
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: 1.4,
              fontFamily: 'inherit',
            }}
          >
            REPLAY
          </button>
          <span style={{ fontSize: 11, letterSpacing: 1 }}>
            PAGES
            {'  '}
            {DENSITIES.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setPageCount(count)}
                style={{ ...chip(count === pageCount), marginLeft: 6 }}
              >
                {count}
              </button>
            ))}
          </span>
          <span style={{ fontSize: 11, letterSpacing: 1 }}>
            RUN
            {'  '}
            {SPEEDS.map((speed) => (
              <button
                key={speed.label}
                type="button"
                onClick={() => setFlipMs(speed.flipMs)}
                style={{ ...chip(speed.flipMs === flipMs), marginLeft: 6 }}
              >
                {(speed.flipMs / 1000).toFixed(1)}s
              </button>
            ))}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 22,
            fontSize: 11,
            color: '#7bd5ef',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <strong style={{ color: '#fff' }}>
              {stats.perSecond.toFixed(1)}
            </strong>{' '}
            PAGES/SEC
          </span>
          <span>
            GAP {Math.round(stats.firstGap)}ms → {Math.round(stats.lastGap)}ms
          </span>
          <span>TOTAL {(totalMs(timing) / 1000).toFixed(1)}s</span>
          <span>
            {entries.length.toString().padStart(3, '0')} PORTRAITS
            {entries.length < pageCount && entries.length > 0
              ? ` · REUSED ${(pageCount / entries.length).toFixed(1)}×`
              : ''}
          </span>
          <span style={{ display: 'flex', gap: 10 }}>
            {mix.map(({ energy, count }) => (
              <span key={energy} style={{ color: ENERGY_CONFIG[energy].accent }}>
                {ENERGY_CONFIG[energy].label} {count}
              </span>
            ))}
          </span>
          {error && <span style={{ color: '#ff9aa5' }}>{error}</span>}
        </div>
      </div>
    </main>
  );
}
