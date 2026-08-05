import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../components/BrandBar';
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
type JoinPhase = 'arriving' | 'perception' | 'settling';

/**
 * At rest the wall is a river of large photos. A capture breaks it into
 * floating tiles and gathers them into the register, then it returns to the
 * river. Only the operator button takes it to the slogan.
 */
type Formation = 'scroll' | 'drift' | 'grid';

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
      window.setTimeout(() => {
        setJoinPhases((current) => {
          const next = { ...current };
          delete next[entry.id];
          return next;
        });
      }, arrivalDriftMs + perceptionMs + settleMs),
      window.setTimeout(() => {
        // A capture that lands while this one is still settling keeps the
        // register formed; only the last one lets the wall break apart.
        pendingArrivalsRef.current -= 1;
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

  /** What the room has earned: the richest phrase its photo count can draw. */
  const decision = useMemo(
    () => planAssembly(records.length, layoutWidth, layoutHeight),
    [records.length],
  );
  const plan = decision.ready ? decision.plan : null;

  /**
   * Targets are handed out in capture order, so the phrase is written in the
   * order the room walked up to the booth rather than at random.
   */
  const assembly = useMemo(() => {
    if (!assembled || !plan) return null;
    const ordered = [...records].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    return new Map(
      ordered.map((entry, index) => [
        entry.shortCode,
        { target: plan.targets[index], order: index },
      ]),
    );
  }, [assembled, plan, records]);

  const riverActive = !assembled && formation === 'scroll' && records.length > 0;

  return (
    <main className="wall-shell">
      <BrandBar wall />
      <section className="collective-stage wall-layout-review" ref={stageRef}>
        <WallPhotoRiver entries={records} active={riverActive} />

        <header className="wall-stage-label">
          {/* Kept away from the assemble control: nobody should reach for the
              stage moment and land on navigation, or the reverse. Hidden while
              the phrase is formed — no chrome in the middle of it. */}
          {!assembled && (
            <button
              type="button"
              className="wall-back-button"
              onClick={goToBooth}
            >
              ← BOOTH
            </button>
          )}
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
            const phase = entry ? joinPhases[entry.id] : undefined;
            const figure =
              entry && phase ? leadFigure(entry.poseTrace) : null;
            const flight = entry ? assembly?.get(entry.shortCode) : undefined;
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
                  !entry && standbySlots.has(slot.index)
                    ? 'is-standby-glow'
                    : ''
                } ${phase ? `is-joining is-${phase}` : ''} ${
                  entry && (entry.personCount ?? 1) > 1 ? 'is-group' : ''
                } ${assembled ? (flight ? 'is-flying' : 'is-dimmed') : ''} ${
                  adrift ? 'is-adrift' : ''
                } ${
                  !assembled &&
                  (riverActive || (!entry && formation !== 'grid'))
                    ? 'is-hidden'
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

        {assembled && plan && (
          <div className="wall-assemble-caption">
            <p>{EVENT_SLOGAN.primary}</p>
            <span>{EVENT_SLOGAN.secondary}</span>
          </div>
        )}

        <div className="wall-layout-status">
          <span>
            <i className={connected ? 'status-dot' : 'status-dot muted'} />
            {connected ? 'LIVE LINK' : 'RECONNECTING'}
          </span>
          <span>{records.length.toString().padStart(3, '0')} / 200 STORED</span>
          {/* Operator control. The assemble never fires on its own, and it
              refuses rather than draw a phrase out of too few photos. */}
          <button
            type="button"
            className="wall-assemble-button"
            onClick={() => setAssembled((current) => !current)}
            disabled={!plan}
            title={
              plan
                ? `${plan.primary} · ${Math.round(plan.tileSizePx)}px tiles`
                : undefined
            }
          >
            {assembled
              ? 'RETURN TO WALL'
              : plan
                ? 'ASSEMBLE SLOGAN'
                : `NEEDS ${decision.ready ? 0 : decision.minimumPhotos} PHOTOS`}
          </button>
        </div>
      </section>
    </main>
  );
}
