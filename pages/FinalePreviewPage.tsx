import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WallFinaleSequence, {
  WALL_FINALE_TOTAL_MS,
} from '../components/WallFinaleSequence';
import {
  FINALE_PHASE_ORDER,
  finaleDurationMs,
  phaseStartMs,
  type FinalePhase,
} from '../services/wallFinaleSequence';
import { FINAL_TAGLINE } from '../constants';
import type { WallEntry } from '../types';

/**
 * The finale in isolation: individual presence → collective convergence → AI
 * perception → distilled message. Nothing here runs on the wall itself — the
 * resting river is a separate route entirely.
 */
export default function FinalePreviewPage() {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/wall/entries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((loaded: WallEntry[]) => setEntries(loaded))
      .catch(() => setError('Could not load wall entries.'));
  }, []);

  const play = useCallback(() => {
    setRunning(false);
    window.setTimeout(() => {
      setStartedAt(performance.now());
      setRunning(true);
    }, 60);
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      setElapsed(performance.now() - startedAt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, startedAt]);

  const currentPhase = useMemo<FinalePhase | null>(() => {
    if (!running) return null;
    let found: FinalePhase = 'freeze';
    for (const phase of FINALE_PHASE_ORDER) {
      if (elapsed >= phaseStartMs(phase)) found = phase;
    }
    return found;
  }, [running, elapsed]);

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
      <WallFinaleSequence
        entries={entries}
        active={running}
        tagline={FINAL_TAGLINE}
      />

      <div
        style={{
          position: 'absolute',
          zIndex: 10,
          left: 22,
          right: 22,
          bottom: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap',
          background: 'rgba(2,7,11,.72)',
          padding: '14px 16px',
          border: '1px solid rgba(123,213,239,.22)',
        }}
      >
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
          {running ? 'REPLAY' : 'PLAY FINALE'}
        </button>
        <span style={{ fontSize: 11, letterSpacing: 1 }}>
          PHASE <strong style={{ color: '#fff' }}>{(currentPhase ?? 'idle').toUpperCase()}</strong>
        </span>
        <span style={{ fontSize: 11, letterSpacing: 1, color: '#7bd5ef' }}>
          {FINALE_PHASE_ORDER.map((phase) => `${phase} ${finaleDurationMs(phase)}ms`).join(' · ')}
        </span>
        <span style={{ fontSize: 11, color: '#7bd5ef' }}>
          {entries.length.toString().padStart(3, '0')} PORTRAITS LOADED ·{' '}
          {(WALL_FINALE_TOTAL_MS() / 1000).toFixed(1)}s to resolved
        </span>
        {error && <span style={{ color: '#ff9aa5', fontSize: 11 }}>{error}</span>}
      </div>
    </main>
  );
}
