import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Participant } from '../types';
import { EVENT_SLOGAN, EVENT_KV_SRC } from '../constants';
import { audioService, SOUND_KEYS } from '../services/audioService';

interface MosaicViewProps {
  participants: Participant[];
  isPaused?: boolean;
}

type Phase = 'scroll' | 'assembling' | 'done';

interface TileItem {
  id: string;
  imageData: string;
  wallLeft: number;
  wallTop: number;
  wallW: number;
  wallH: number;
  sloganLeft: number;
  sloganTop: number;
  sloganW: number;
  sloganH: number;
  delayMs: number;
}

const WALL_COLS = 14;
const WALL_ROWS = 9;
const TILE_COUNT = WALL_COLS * WALL_ROWS;
/** One full diagonal loop duration (slower = calmer wall) */
const DIAG_PAN_SECONDS = 160;

function sampleSloganTargets(
  primary: string,
  secondary: string,
  count: number
): { x: number; y: number }[] {
  const W = 960;
  const H = 540;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const primarySize = Math.min(90, Math.floor(W / Math.max(primary.length * 0.85, 6)));
  ctx.font = `900 ${primarySize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  ctx.fillText(primary, W / 2, H * 0.42);

  if (secondary) {
    const secondarySize = Math.min(28, Math.floor(W / Math.max(secondary.length * 0.55, 8)));
    ctx.font = `600 ${secondarySize}px Inter, "Helvetica Neue", sans-serif`;
    ctx.fillText(secondary, W / 2, H * 0.62);
  }

  const { data } = ctx.getImageData(0, 0, W, H);
  const raw: { x: number; y: number }[] = [];
  const step = 5;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4 + 3] > 140) {
        raw.push({ x: (x / W) * 100, y: (y / H) * 100 });
      }
    }
  }

  if (raw.length === 0) {
    return Array.from({ length: count }, (_, i) => ({
      x: 15 + (i % 24) * 3,
      y: 30 + Math.floor(i / 24) * 4,
    }));
  }

  const targets: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    targets.push(raw[Math.floor((i / count) * raw.length) % raw.length]);
  }
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }
  return targets;
}

function buildLayout(count: number): Omit<TileItem, 'imageData'>[] {
  const cellW = 100 / WALL_COLS;
  const cellH = 100 / WALL_ROWS;
  const sloganTargets = sampleSloganTargets(
    EVENT_SLOGAN.primary,
    EVENT_SLOGAN.secondary,
    count
  );
  const sloganTileW = 1.05;
  const sloganTileH = 1.05;

  return Array.from({ length: count }, (_, i) => {
    const col = i % WALL_COLS;
    const row = Math.floor(i / WALL_COLS);
    const target = sloganTargets[i] || { x: 50, y: 50 };
    const dist = Math.hypot(target.x - 50, target.y - 50);
    return {
      id: `tile-${i}`,
      wallLeft: col * cellW,
      wallTop: row * cellH + (col % 2) * cellH * 0.12,
      wallW: cellW,
      wallH: cellH,
      sloganLeft: target.x - sloganTileW / 2,
      sloganTop: target.y - sloganTileH / 2,
      sloganW: sloganTileW,
      sloganH: sloganTileH,
      delayMs: Math.floor(dist * 22) + Math.floor(Math.random() * 100),
    };
  });
}

export const MosaicView: React.FC<MosaicViewProps> = ({ participants, isPaused = false }) => {
  const [phase, setPhase] = useState<Phase>('scroll');
  const [frozenTiles, setFrozenTiles] = useState<TileItem[]>([]);
  /** false = still at wall coords; true = fly to slogan (enables CSS transition) */
  const [assembleGo, setAssembleGo] = useState(false);
  const doneTimerRef = useRef<number | null>(null);

  const layout = useMemo(() => buildLayout(TILE_COUNT), []);

  // Static fill — photos move with the wall; no per-tile swap
  const liveTiles: TileItem[] = useMemo(() => {
    if (participants.length === 0) return [];
    return layout.map((cell, i) => ({
      ...cell,
      imageData: participants[i % participants.length].imageData,
    }));
  }, [layout, participants]);

  const displayTiles = phase === 'scroll' ? liveTiles : frozenTiles.length ? frozenTiles : liveTiles;

  const startAssemble = useCallback(() => {
    if (phase !== 'scroll' || liveTiles.length === 0 || !liveTiles[0]?.imageData) return;

    setFrozenTiles(liveTiles);
    setAssembleGo(false);
    setPhase('assembling');
    audioService.init();
    audioService.play(SOUND_KEYS.ASSEMBLE, 0.55);

    // Mount at wall positions first, then next frames enable slogan targets → CSS morph
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAssembleGo(true));
    });

    if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    const maxDelay = liveTiles.reduce((m, t) => Math.max(m, t.delayMs), 0);
    doneTimerRef.current = window.setTimeout(() => setPhase('done'), maxDelay + 1700);
  }, [phase, liveTiles]);

  const reset = useCallback(() => {
    if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    setPhase('scroll');
    setFrozenTiles([]);
    setAssembleGo(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'a') startAssemble();
      if (key === 'r') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startAssemble, reset]);

  useEffect(() => {
    return () => {
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    };
  }, []);

  const isAssembled = phase === 'assembling' || phase === 'done';

  if (participants.length === 0) {
    return (
      <div className="h-full w-full bg-[#020617] flex items-center justify-center">
        <div className="text-center text-white/40 font-mono tracking-widest uppercase text-sm">
          Waiting for photos…
          <div className="mt-2 text-xs text-white/25">等待拍照同步</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#020617] overflow-hidden relative">
      <img
        src={EVENT_KV_SRC}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-[2000ms] pointer-events-none ${
          phase === 'done' ? 'opacity-40' : 'opacity-0'
        }`}
      />

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[80] pointer-events-none text-[10px] font-mono tracking-[0.35em] uppercase text-white/25">
        {phase === 'scroll' ? '斜移无限拼接 · Press A 组成 Slogan' : 'Press R · 回到墙面'}
      </div>

      <div className="absolute inset-0 overflow-hidden">
        {isAssembled ? (
          /* Same tile nodes: wall → slogan morph */
          <div className="absolute inset-0">
            {displayTiles.map((tile) => {
              if (!tile.imageData) return null;
              const toSlogan = assembleGo || phase === 'done';
              const left = toSlogan ? tile.sloganLeft : tile.wallLeft;
              const top = toSlogan ? tile.sloganTop : tile.wallTop;
              const w = toSlogan ? tile.sloganW : tile.wallW;
              const h = toSlogan ? tile.sloganH : tile.wallH;
              const pad = toSlogan ? 0.06 : 0.12;

              return (
                <div
                  key={tile.id}
                  className="absolute overflow-hidden bg-slate-900"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${Math.max(w - pad, 0.35)}%`,
                    height: `${Math.max(h - pad, 0.35)}%`,
                    transitionProperty: 'left, top, width, height, box-shadow, border-radius',
                    transitionDuration: toSlogan ? '1500ms' : '0ms',
                    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    transitionDelay: toSlogan ? `${tile.delayMs}ms` : '0ms',
                    borderRadius: toSlogan ? '2px' : '0px',
                    boxShadow: toSlogan ? '0 0 6px rgba(56,189,248,0.35)' : 'none',
                  }}
                >
                  <img src={tile.imageData} alt="" className="w-full h-full object-cover" draggable={false} />
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={`absolute top-0 left-0 ${!isPaused ? 'wall-diag-pan' : ''}`}
            style={{
              width: '200%',
              height: '200%',
              willChange: 'transform',
            }}
          >
            {[0, 1, 2, 3].map((panel) => (
              <div
                key={`panel-${panel}`}
                className="absolute overflow-hidden"
                style={{
                  width: '50%',
                  height: '50%',
                  left: panel % 2 === 0 ? '0%' : '50%',
                  top: panel < 2 ? '0%' : '50%',
                }}
              >
                {displayTiles.map((tile) => {
                  if (!tile.imageData) return null;
                  const pad = 0.12;
                  return (
                    <div
                      key={`${panel}-${tile.id}`}
                      className="absolute overflow-hidden bg-slate-900"
                      style={{
                        left: `${tile.wallLeft}%`,
                        top: `${tile.wallTop}%`,
                        width: `${Math.max(tile.wallW - pad, 0.35)}%`,
                        height: `${Math.max(tile.wallH - pad, 0.35)}%`,
                      }}
                    >
                      <img src={tile.imageData} alt="" className="w-full h-full object-cover" draggable={false} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {!isAssembled && (
        <div className="absolute inset-0 pointer-events-none z-10 bg-[radial-gradient(ellipse_at_center,transparent_50%,#020617_100%)]" />
      )}

      {isAssembled && (
        <div className="absolute inset-0 pointer-events-none z-[5] bg-[#020617]/50" />
      )}

      <div
        className={`absolute bottom-[8%] left-0 right-0 z-20 text-center transition-all duration-1000 ${
          phase === 'done' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <p className="text-white/90 text-2xl md:text-4xl font-black tracking-wide">
          {EVENT_SLOGAN.primary}
        </p>
        <p className="text-white/50 text-sm mt-2 tracking-widest">{EVENT_SLOGAN.eventTitle}</p>
        <p className="text-cyan-300/60 text-xs mt-1 tracking-[0.35em] uppercase font-mono">
          {EVENT_SLOGAN.secondary}
        </p>
      </div>

      <style>{`
        @keyframes wallDiagPan {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, -50%, 0); }
        }
        .wall-diag-pan {
          animation: wallDiagPan ${DIAG_PAN_SECONDS}s linear infinite;
        }
      `}</style>
    </div>
  );
};
