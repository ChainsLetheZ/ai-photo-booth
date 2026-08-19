import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WallIntelligenceField, {
  type WallIntelligencePhase,
  type WallSignalPoint,
} from '../components/WallIntelligenceField';
import WallPhotoRiver from '../components/WallPhotoRiver';
import WallPoseFigure from '../components/WallPoseFigure';
import { wallConfig } from '../config/wallConfig';
import { ENERGY_CONFIG, FINAL_TAGLINE } from '../constants';
import {
  listWallEntries,
  subscribeToWallEntries,
} from '../services/portraitStore';
import { driftPlacement } from '../services/wallDrift';
import { leadFigure } from '../services/wallPoseFigure';
import WallFinaleSequence, {
  type FinaleStartMap,
} from '../components/WallFinaleSequence';
import {
  finaleCardWidthPx,
  finaleDurationMs,
  nextFinalePhase,
  type FinalePhase,
} from '../services/wallFinaleSequence';
import type { WallEntry } from '../types';

/**
 * A new photo floats on its own first, then the wall gathers into the register
 * around it, shows the pose that was perceived, and finally reveals the photo.
 */
type JoinPhase = WallIntelligencePhase;

/**
 * At rest the wall is a river of large photos. A capture breaks it into
 * floating tiles and gathers them into the register, then it returns to the
 * river. The operator's Space key takes it to the finale; the display itself
 * deliberately contains no controls or browser-like chrome.
 */
type Formation = 'scroll' | 'drift' | 'grid';

const PREVIEW_SIGNAL_COUNT = 12;
const PREVIEW_ENERGIES = [
  ENERGY_CONFIG.Intelligence.accent,
  ENERGY_CONFIG.Motion.accent,
  ENERGY_CONFIG.Life.accent,
  ENERGY_CONFIG.Impact.accent,
] as const;

function captureFinaleStarts(
  stage: HTMLElement | null,
  cardCount: number,
): FinaleStartMap {
  if (!stage || cardCount <= 0) return {};
  const stageRect = stage.getBoundingClientRect();
  const finalCardWidth = finaleCardWidthPx(
    stageRect.width,
    stageRect.height,
    cardCount,
  );
  if (finalCardWidth <= 0) return {};

  const starts = new Map<string, FinaleStartPosition[]>();
  stage
    .querySelectorAll<HTMLImageElement>('.wall-river-tile[data-entry-id] img')
    .forEach((image) => {
      const tile = image.closest<HTMLElement>('.wall-river-tile');
      const id = tile?.dataset.entryId;
      if (!id) return;
      const rect = image.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, stageRect.right) - Math.max(rect.left, stageRect.left),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top),
      );
      const visibleArea = visibleWidth * visibleHeight;
      if (visibleArea <= 0) return;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const list = starts.get(id) ?? [];
      list.push({
        // Keep the actual centre, including the part that is just beyond an
        // edge of the LED. It gives the finale a mix of on-wall launches and
        // edge arrivals instead of forcing every photo to begin in-frame.
        xUnit: (x - stageRect.left) / stageRect.width,
        yUnit: (y - stageRect.top) / stageRect.height,
        // Match the existing river tile at t=0. The visible wall photo itself
        // then shrinks into the letterform — there is no thumbnail duplicate.
        scale: Math.min(64, Math.max(1, rect.width / finalCardWidth)),
      });
      starts.set(id, list);
    });

  return Object.fromEntries(
    [...starts],
  );
}

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
  const [, setConnected] = useState(false);
  const [layoutScale, setLayoutScale] = useState(1);
  const [standbySlots, setStandbySlots] = useState<Set<number>>(
    chooseStandbySlots,
  );
  const [joinPhases, setJoinPhases] = useState<Record<string, JoinPhase>>({});
  const [formation, setFormation] = useState<Formation>('scroll');
  const [finale, setFinale] = useState<FinalePhase | null>(null);
  const [finaleEntries, setFinaleEntries] = useState<WallEntry[]>([]);
  const [finaleStarts, setFinaleStarts] = useState<FinaleStartMap>({});
  const assembled = finale !== null;
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
      // The original camera frame is uploaded asynchronously after the
      // composed portrait is ready. `imageUrl` is already a valid wall image,
      // so never hide an otherwise published portrait while that optional
      // upgrade is still in flight (or absent on older records).
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

  /**
   * `freeze` belongs to the wall's own tiles — they fade on the opacity
   * transition below, nothing here drives them. Every later phase advances on
   * its own uninterrupted clock inside `WallFinaleSequence`; this state only
   * labels the current beat and controls when the live river may fade. The
   * `tagline` state is the end and does not advance, while the component still
   * completes its blur-to-sharp reveal and then naturally holds the last frame.
   */
  useEffect(() => {
    if (!finale) return;
    const next = nextFinalePhase(finale);
    if (!next) return;
    const timer = window.setTimeout(
      () => setFinale(next),
      finaleDurationMs(finale),
    );
    return () => window.clearTimeout(timer);
  }, [finale]);

  const riverActive = !assembled && formation === 'scroll' && records.length > 0;
  // During the actual gathering, keep the live river moving behind the cards.
  // The finale cards therefore peel directly from the wall rather than
  // appearing after a blackout. The river fades only once the word is formed.
  const riverVisibleDuringFinale =
    finale === 'freeze' || finale === 'converge';
  const toggleFinale = useCallback(() => {
    if (finale) {
      setFinale(null);
      setFinaleEntries([]);
      setFinaleStarts({});
      return;
    }
    const snapshot = [...records];
    setFinaleEntries(snapshot);
    setFinaleStarts(
      riverActive
        ? captureFinaleStarts(
            stageRef.current,
            snapshot.length,
          )
        : {},
    );
    setFinale('freeze');
  }, [finale, records, riverActive]);

  useEffect(() => {
    const onSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      toggleFinale();
    };
    window.addEventListener('keydown', onSpace);
    return () => window.removeEventListener('keydown', onSpace);
  }, [toggleFinale]);

  return (
    <main className="wall-shell">
      <section
        className={`collective-stage wall-layout-review ${
          activeJoin ? `is-ai-joining is-ai-${activeJoin.phase}` : ''
        }`}
        ref={stageRef}
      >
        <WallPhotoRiver
          entries={records}
          active={riverActive || riverVisibleDuringFinale}
          freeze={false}
        />

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
          {slots.map((slot) => {
            const entry = entriesByCode.get(slot.shortCode);
            const preview = !entry && slot.index < PREVIEW_SIGNAL_COUNT;
            const motion = entry ? entryMotion(entry.id) : null;
            const phase = entry ? joinPhases[entry.id] : undefined;
            const figure =
              entry && (phase === 'perception' || phase === 'settling')
                ? leadFigure(entry.poseTrace)
                : null;
            const energy = entry
              ? ENERGY_CONFIG[entry.primaryEnergy]
              : undefined;
            const { returnMs, amplitudePx } = wallConfig.drift;
            const drift = entry ? driftByCode.get(entry.shortCode) : undefined;
            // The register never moves for the finale — it just fades out from
            // wherever it already was, on the transition below. Only the wall's
            // own idle formations (river / drift / grid) place a tile.
            const adrift = Boolean(
              !assembled && drift && formation !== 'grid',
            );
            const placed =
              adrift && drift
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
                } ${assembled ? 'is-dimmed' : ''} ${
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
                    // The register itself never moves for the finale — it only
                    // fades, on the same clock as the wall's own `freeze`, so
                    // the fade and the sequence's arrival read as one motion.
                    transition: finale
                      ? `opacity ${finaleDurationMs('freeze')}ms ease`
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
                    src={entry.sourceImageUrl ?? entry.imageUrl}
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

        {/* individual presence → collective convergence → AI perception →
            distilled message. The sentence arrives and stays; there is no
            caption repeating it underneath, the wall is already showing it.
            `pointer-events: none` matters: this layer covers the operator's
            own controls, and must never intercept a click meant for them. */}
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <WallFinaleSequence
            entries={finale ? finaleEntries : records}
            active={finale !== null}
            tagline={FINAL_TAGLINE}
            startPositions={finaleStarts}
          />
        </div>

      </section>
    </main>
  );
}
