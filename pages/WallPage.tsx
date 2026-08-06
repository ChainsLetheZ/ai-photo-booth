import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../components/BrandBar';
import WallIntelligenceField, {
  type WallIntelligencePhase,
  type WallSignalPoint,
} from '../components/WallIntelligenceField';
import WallPhotoRiver from '../components/WallPhotoRiver';
import WallPoseFigure from '../components/WallPoseFigure';
import { wallConfig } from '../config/wallConfig';
import { ENERGY_CONFIG, EVENT_SLOGAN } from '../constants';
import {
  listWallEntries,
  subscribeToWallEntries,
} from '../services/portraitStore';
import { driftPlacement } from '../services/wallDrift';
import { planAssembly } from '../services/sloganTargets';
import { leadFigure } from '../services/wallPoseFigure';
import type { WallEntry } from '../types';

/**
 * A new photo floats on its own first, then the wall gathers into the register
 * around it, shows the pose that was perceived, and finally reveals the photo.
 */
type JoinPhase = WallIntelligencePhase;

/**
 * At rest the wall is a river of large photos. A capture breaks it into
 * floating tiles and gathers them into the register, then it returns to the
 * river. Only the operator button takes it to the slogan.
 */
type Formation = 'scroll' | 'drift' | 'grid';

const PREVIEW_SIGNAL_COUNT = 12;
const DEMO_ASSEMBLY_SIGNAL_COUNT = wallConfig.capacity;
const PREVIEW_ENERGIES = [
  ENERGY_CONFIG.Intelligence.accent,
  ENERGY_CONFIG.Motion.accent,
  ENERGY_CONFIG.Life.accent,
  ENERGY_CONFIG.Impact.accent,
] as const;

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
  const [joinPhases, setJoinPhases] = useState<Record<string, JoinPhase>>({});
  const [formation, setFormation] = useState<Formation>('scroll');
  const [assembled, setAssembled] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const knownIdsRef = useRef(new Set<string>());
  const joinTimersRef = useRef<number[]>([]);
  const pendingArrivalsRef = useRef(0);

  /** Entries already on the wall when this screen opened must not replay. */
  const beginJoin = useCallback((entry: WallEntry) => {
    if (knownIdsRef.current.has(entry.id)) return;
    knownIdsRef.current.add(entry.id);
    const { perceptionMs, settleMs } = wallConfig.joinAnimation;
    const { arrivalDriftMs, holdMs } = wallConfig.drift;
    const setPhase = (phase: JoinPhase) =>
      setJoinPhases((current) => ({ ...current, [entry.id]: phase }));

    pendingArrivalsRef.current += 1;
    // The river breaks apart the moment a capture lands, and the newcomer
    // floats in with it before anything gathers.
    setFormation('drift');
    setPhase('arriving');
    joinTimersRef.current.push(
      window.setTimeout(() => {
        setFormation('grid');
        setPhase('perception');
      }, arrivalDriftMs),
      window.setTimeout(
        () => setPhase('settling'),
        arrivalDriftMs + perceptionMs,
      ),
      window.setTimeout(
        () => setPhase('integrated'),
        arrivalDriftMs + perceptionMs + settleMs,
      ),
      window.setTimeout(() => {
        // A capture that lands while this one is still settling keeps the
        // register formed; only the last one lets the wall break apart.
        pendingArrivalsRef.current -= 1;
        setJoinPhases((current) => {
          const next = { ...current };
          delete next[entry.id];
          return next;
        });
        if (pendingArrivalsRef.current <= 0) setFormation('scroll');
      }, arrivalDriftMs + perceptionMs + settleMs + holdMs),
    );
  }, []);

  useEffect(() => {
    const adopt = (entries: WallEntry[]) => {
      entries.forEach((entry) => knownIdsRef.current.add(entry.id));
      setRecords(entries);
    };
    listWallEntries().then(adopt);
    return subscribeToWallEntries(
      (entry) => {
        beginJoin(entry);
        setRecords((current) => upsert(current, entry));
      },
      adopt,
      setConnected,
    );
  }, [beginJoin]);

  useEffect(
    () => () => {
      joinTimersRef.current.forEach(window.clearTimeout);
      joinTimersRef.current = [];
    },
    [],
  );

  /**
   * A soft route change, not an anchor: a full reload would re-download the
   * pose and gesture models and leave the booth unusable for several seconds.
   */
  const goToBooth = useCallback(() => {
    window.history.pushState(null, '', '/booth');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') goToBooth();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goToBooth]);

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
      // A stage measured before layout settles gives a negative scale, which
      // mirrors the whole wall and shrinks it to nothing.
      if (bounds.width <= 0 || bounds.height <= 0) return;
      setLayoutScale(
        Math.max(
          0.05,
          Math.min(
            1,
            (bounds.width - 40) / layoutWidth,
            (bounds.height - 40) / layoutHeight,
          ),
        ),
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

  const driftByCode = useMemo(() => {
    const ordered = [...records].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    return new Map(
      ordered.map((entry, index) => [
        entry.shortCode,
        driftPlacement(entry.id, index, ordered.length),
      ]),
    );
  }, [records]);

  const activeJoin = useMemo(() => {
    const joining = records
      .filter((entry) => joinPhases[entry.id])
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!joining) return null;
    const slot = slots.find((candidate) => candidate.shortCode === joining.shortCode);
    if (!slot) return null;

    const pointFor = (entry: WallEntry, entrySlot: (typeof slots)[number]): WallSignalPoint => {
      const drift = driftByCode.get(entry.shortCode);
      const useDrift = formation !== 'grid' && drift;
      return {
        id: entry.id,
        x: useDrift ? drift.x * layoutWidth : entrySlot.x + cellWidthPx / 2,
        y: useDrift ? drift.y * layoutHeight : entrySlot.y + cellHeightPx / 2,
      };
    };

    const focus = pointFor(joining, slot);
    const nodes = records
      .filter((entry) => entry.id !== joining.id)
      .map((entry) => {
        const entrySlot = slots.find(
          (candidate) => candidate.shortCode === entry.shortCode,
        );
        if (!entrySlot) return null;
        const point = pointFor(entry, entrySlot);
        return {
          ...point,
          distance: Math.hypot(point.x - focus.x, point.y - focus.y),
        };
      })
      .filter((point): point is WallSignalPoint & { distance: number } => Boolean(point))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 10);

    return {
      entry: joining,
      phase: joinPhases[joining.id],
      focus,
      nodes,
    };
  }, [driftByCode, formation, joinPhases, records, slots]);

  /** What the room has earned from real portraits. */
  const decision = useMemo(
    () =>
      planAssembly(records.length, layoutWidth, layoutHeight, [
        wallConfig.assemble.targets[1],
      ]),
    [records.length],
  );
  const livePlan = decision.ready ? decision.plan : null;
  const demoDecision = useMemo(
    () =>
      planAssembly(
        DEMO_ASSEMBLY_SIGNAL_COUNT,
        layoutWidth,
        layoutHeight,
        [wallConfig.assemble.targets[1]],
      ),
    [],
  );
  const demoPlan = demoDecision.ready ? demoDecision.plan : null;
  const plan = livePlan ?? demoPlan;
  const demoAssembling = assembled && !livePlan;

  /**
   * Targets are handed out in capture order, so the phrase is written in the
   * order the room walked up to the booth rather than at random.
   */
  const assembly = useMemo(() => {
    if (!assembled || !plan) return null;
    if (!livePlan) {
      return new Map(
        slots.slice(0, DEMO_ASSEMBLY_SIGNAL_COUNT).map((slot, index) => [
          slot.shortCode,
          { target: plan.targets[index], order: index },
        ]),
      );
    }
    const ordered = [...records].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    return new Map(
      ordered.map((entry, index) => [
        entry.shortCode,
        { target: plan.targets[index], order: index },
      ]),
    );
  }, [assembled, livePlan, plan, records, slots]);

  const riverActive = !assembled && formation === 'scroll' && records.length > 0;

  return (
    <main className="wall-shell">
      <BrandBar wall />
      <section
        className={`collective-stage wall-layout-review ${
          activeJoin ? `is-ai-joining is-ai-${activeJoin.phase}` : ''
        }`}
        ref={stageRef}
      >
        <WallPhotoRiver entries={records} active={riverActive} />

        {activeJoin && (
          <div
            className="wall-ai-atmosphere"
            style={
              {
                '--wall-ai-energy':
                  ENERGY_CONFIG[activeJoin.entry.primaryEnergy].accent,
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        )}

        <header className="wall-stage-label">
          {/* Kept away from the assemble control: nobody should reach for the
              stage moment and land on navigation, or the reverse. Hidden while
              the phrase is formed — no chrome in the middle of it. */}
          <button
            type="button"
            className="wall-back-button"
            onClick={goToBooth}
          >
            ← BOOTH
          </button>
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
          {activeJoin && (
            <WallIntelligenceField
              width={layoutWidth}
              height={layoutHeight}
              focus={activeJoin.focus}
              nodes={activeJoin.nodes}
              phase={activeJoin.phase}
              energy={ENERGY_CONFIG[activeJoin.entry.primaryEnergy].accent}
            />
          )}
          {assembled && plan && (
            <div
              className="wall-slogan-ink"
              style={
                {
                  '--wall-slogan-font-size': `${
                    Math.min(
                      120,
                      Math.floor(
                        wallConfig.assemble.sampleWidth /
                          Math.max(EVENT_SLOGAN.primary.length * 0.85, 6),
                      ),
                    ) *
                    (layoutWidth / wallConfig.assemble.sampleWidth)
                  }px`,
                } as React.CSSProperties
              }
              aria-hidden="true"
            >
              {EVENT_SLOGAN.primary}
            </div>
          )}
          {slots.map((slot) => {
            const entry = entriesByCode.get(slot.shortCode);
            const preview =
              !entry &&
              (slot.index < PREVIEW_SIGNAL_COUNT ||
                (demoAssembling && slot.index < DEMO_ASSEMBLY_SIGNAL_COUNT));
            const motion = entry ? entryMotion(entry.id) : null;
            const phase = entry ? joinPhases[entry.id] : undefined;
            const figure =
              entry && (phase === 'perception' || phase === 'settling')
                ? leadFigure(entry.poseTrace)
                : null;
            const flight = assembly?.get(slot.shortCode);
            const energy = entry
              ? ENERGY_CONFIG[entry.primaryEnergy]
              : undefined;
            const { flightMs, staggerMs } = wallConfig.assemble;
            const tileSizePx = plan?.tileSizePx ?? wallConfig.assemble.minTilePx;
            const { returnMs, amplitudePx } = wallConfig.drift;
            const drift = entry ? driftByCode.get(entry.shortCode) : undefined;
            // The button wins over everything. Otherwise only the register is
            // laid out on the grid; tiles hold their floating positions under
            // the river too, so surfacing from it is a fade and not a jump.
            const adrift = Boolean(
              !assembled && drift && formation !== 'grid',
            );
            const placed = flight
              ? {
                  left: flight.target.x * layoutWidth - tileSizePx / 2,
                  top: flight.target.y * layoutHeight - tileSizePx / 2,
                  width: tileSizePx,
                  height: tileSizePx,
                }
              : adrift && drift
                ? {
                    left: drift.x * layoutWidth - cellWidthPx / 2,
                    top: drift.y * layoutHeight - cellHeightPx / 2,
                    width: cellWidthPx,
                    height: cellHeightPx,
                  }
                : {
                    left: slot.x,
                    top: slot.y,
                    width: cellWidthPx,
                    height: cellHeightPx,
                  };

            return (
              <div
                className={`hex-wall-slot ${entry ? 'is-filled' : 'is-empty'} ${
                  preview ? 'is-preview' : ''
                } ${
                  !entry && standbySlots.has(slot.index)
                    ? 'is-standby-glow'
                    : ''
                } ${phase ? `is-joining is-${phase}` : ''} ${
                  entry && (entry.personCount ?? 1) > 1 ? 'is-group' : ''
                } ${assembled ? (flight ? 'is-flying' : 'is-dimmed') : ''} ${
                  adrift ? 'is-adrift' : ''
                } ${
                  !assembled &&
                  (riverActive || (!entry && formation === 'drift'))
                    ? 'is-hidden'
                    : ''
                }`}
                key={slot.shortCode}
                aria-label={
                  entry
                    ? `Wall portrait ${slot.shortCode}`
                    : preview
                      ? `Preview portrait place ${slot.shortCode}`
                      : `Empty wall place ${slot.shortCode}`
                }
                style={
                  {
                    left: `${placed.left}px`,
                    top: `${placed.top}px`,
                    width: `${placed.width}px`,
                    height: `${placed.height}px`,
                    transition: assembled
                      ? `left ${flightMs}ms cubic-bezier(0.22,1,0.36,1) ${flight ? flight.order * staggerMs : 0}ms, top ${flightMs}ms cubic-bezier(0.22,1,0.36,1) ${flight ? flight.order * staggerMs : 0}ms, width ${flightMs}ms ease, height ${flightMs}ms ease, opacity 600ms ease`
                      : `left ${returnMs}ms cubic-bezier(0.22,1,0.36,1), top ${returnMs}ms cubic-bezier(0.22,1,0.36,1), opacity ${returnMs}ms ease`,
                    '--wall-drift-amplitude': `${amplitudePx}px`,
                    '--wall-drift-period': drift
                      ? `${drift.periodMs.toFixed(0)}ms`
                      : undefined,
                    '--wall-drift-delay': drift
                      ? `${drift.delayMs.toFixed(0)}ms`
                      : undefined,
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
                    '--wall-energy': energy?.accent,
                    '--wall-preview-energy': preview
                      ? PREVIEW_ENERGIES[slot.index % PREVIEW_ENERGIES.length]
                      : undefined,
                    '--wall-join-perception': `${wallConfig.joinAnimation.perceptionMs}ms`,
                    '--wall-join-settle': `${wallConfig.joinAnimation.settleMs}ms`,
                  } as React.CSSProperties
                }
              >
                {figure && (
                  <WallPoseFigure
                    figure={figure}
                    personCount={entry?.personCount ?? 1}
                  />
                )}
                {preview && (
                  <div className="wall-preview-portrait" aria-hidden="true">
                    <i className="wall-preview-head" />
                    <i className="wall-preview-body" />
                    <span>AI SIGNAL</span>
                    <small>#{slot.shortCode}</small>
                  </div>
                )}
                {entry && (
                  <img
                    className="hex-wall-photo"
                    src={entry.imageUrl}
                    alt={`Collective portrait ${entry.shortCode}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {records.length === 0 && !activeJoin && !assembled && (
          <aside className="wall-preview-note">
            <i />
            <div>
              <strong>WALL PREVIEW ACTIVE</strong>
              <span>LIVE PORTRAITS WILL REPLACE THESE SIGNALS</span>
            </div>
          </aside>
        )}

        {activeJoin && (
          <aside
            className={`wall-ai-readout is-${activeJoin.phase}`}
            style={
              {
                '--wall-ai-energy':
                  ENERGY_CONFIG[activeJoin.entry.primaryEnergy].accent,
              } as React.CSSProperties
            }
            aria-live="polite"
          >
            <div className="wall-ai-readout-heading">
              <i />
              <span>COLLECTIVE INTELLIGENCE</span>
              <b>#{activeJoin.entry.shortCode}</b>
            </div>
            <strong>
              {activeJoin.phase === 'arriving'
                ? 'SIGNAL ENTERING FIELD'
                : activeJoin.phase === 'perception'
                  ? 'POSE SIGNATURE DETECTED'
                  : activeJoin.phase === 'settling'
                    ? 'SYNTHESIZING CONNECTIONS'
                    : 'COLLECTIVE MODEL UPDATED'}
            </strong>
            <div className="wall-ai-progress" aria-hidden="true">
              <i className="is-drift" />
              <i className="is-read" />
              <i className="is-link" />
              <i className="is-lock" />
            </div>
            <small>
              {activeJoin.phase === 'integrated'
                ? `${records.length.toString().padStart(3, '0')} PORTRAITS · SIGNAL INTEGRATED`
                : `${activeJoin.nodes.length.toString().padStart(2, '0')} NEAREST SIGNALS LINKED`}
            </small>
          </aside>
        )}

        {assembled && plan && (
          <div className="wall-assemble-caption">
            <p>{EVENT_SLOGAN.primary}</p>
            <span>{EVENT_SLOGAN.secondary}</span>
          </div>
        )}

        {demoAssembling && (
          <div className="wall-demo-assembly-badge">
            DEMO MODE · {DEMO_ASSEMBLY_SIGNAL_COUNT} SYNTHETIC SIGNALS
          </div>
        )}

        <div className="wall-layout-status">
          <span>
            <i className={connected ? 'status-dot' : 'status-dot muted'} />
            {connected ? 'LIVE LINK' : 'RECONNECTING'}
          </span>
          <span>{records.length.toString().padStart(3, '0')} / 200 STORED</span>
          {/* Real portraits win. Synthetic signals complete the same finale
              while the live wall is still below the required photo count. */}
          <button
            type="button"
            className="wall-assemble-button"
            onClick={() => setAssembled((current) => !current)}
            title={
              plan
                ? `${livePlan ? 'LIVE' : 'DEMO'} · ${plan.primary} · ${Math.round(plan.tileSizePx)}px tiles`
                : undefined
            }
          >
            {assembled
              ? 'RETURN TO WALL'
              : livePlan
                ? 'ASSEMBLE 8-CHAR FINALE'
                : 'PREVIEW 8-CHAR ASSEMBLY'}
          </button>
        </div>
      </section>
    </main>
  );
}
