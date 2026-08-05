/**
 * Diagnostics only. Every layer of the skeleton pipeline reports whether it
 * produced output for the current frame, so a skeleton that disappears for a
 * few hundred milliseconds can be attributed to one layer instead of guessed
 * at. No layer changes behaviour because of what is recorded here.
 *
 * Layers:
 *   L1 video.readyState   camera frames reaching the inference loop
 *   L2 inference calls    loop ticks that were due and actually ran
 *   L3 raw poses          poses MoveNet returned
 *   L4 sanity filter      poses that survived poseSanityFilter
 *   L5 confirmed tracks   tracks PersonTrackStore confirmed
 *   L6 keypoints above    people with at least one keypoint above scoreThreshold
 *   L7 render frames      canvas frames that actually drew a skeleton
 */

export const PIPELINE_WINDOW_MS = 10_000;

/**
 * A `blank` gap is a frame that cleared the canvas and drew nothing: the
 * skeleton actually vanished. A `stale` gap is the canvas simply not being
 * redrawn — the skeleton froze on its last pose and stayed on screen.
 * Only `blank` gaps are the reported symptom.
 */
export type PipelineGapKind = 'blank' | 'stale';

/** Below this, a blank frame is inference cadence, not a visible gap. */
export const GAP_MIN_MS = 120;

/**
 * Inference runs near 10Hz on this machine (~60ms infer, ~104ms per frame), so
 * one dropped redraw already crosses GAP_MIN_MS. A freeze has to outlast two
 * frames before it is worth reporting.
 */
export const STALE_GAP_MIN_MS = 260;

const GAP_HISTORY_SIZE = 24;

export type PipelineLayerId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type PipelineRenderSource = 'halo' | 'landmarks';

export interface PipelineBlame {
  layer: PipelineLayerId;
  detail: string;
}

export interface PipelineGap extends PipelineBlame {
  kind: PipelineGapKind;
  startedAt: number;
  durationMs: number;
  open: boolean;
}

export interface PipelineLayerSnapshot {
  id: PipelineLayerId;
  label: string;
  value: string;
  failLabel: string;
  failCount: number;
  detail: string;
}

export interface PipelineHealthSnapshot {
  windowMs: number;
  layers: PipelineLayerSnapshot[];
  lastGap: PipelineGap | null;
  gapHistory: PipelineGap[];
  /** Whole-session blank totals, for comparing one configuration to another. */
  session: {
    blankGaps: number;
    blankMs: number;
    /** Time from the first drawn skeleton to the latest report. */
    observedMs: number;
    byLayer: Record<string, number>;
  };
}

export interface PipelineCaptureReport {
  readyState: number;
  /** The tick was due for inference under the target FPS budget. */
  due: boolean;
  /** Inference actually started on this tick. */
  started: boolean;
}

export type RejectReasonCounts = Readonly<Record<string, number | undefined>>;

export interface PipelineFrameReport {
  rawPoseCount: number;
  /** Poses the model produced before the minPoseScore gate. */
  modelPoseCount?: number;
  topPoseScore?: number | null;
  minPoseScore?: number;
  /** Measured numbers behind the sanity rejection, from the filter itself. */
  sanityDetail?: string;
  sanityAcceptedCount: number;
  rejectReasons: RejectReasonCounts;
  confirmedCount: number;
  reassociatedCount: number;
  /** People handed to the render layers for this frame. */
  renderPeopleCount: number;
  /** Of those, how many carry at least one keypoint above scoreThreshold. */
  renderablePeopleCount: number;
  /** False in simple mode, where accepted (not confirmed) people are rendered. */
  renderRequiresConfirmedTracks: boolean;
}

export interface PipelineRenderReport {
  source: PipelineRenderSource;
  /** People available to draw this canvas frame. */
  available: number;
  /** People actually drawn. */
  drawn: number;
}

const LAYER_META: Record<
  PipelineLayerId,
  { label: string; failLabel: string }
> = {
  1: { label: 'video.readyState', failLabel: 'stalls' },
  2: { label: 'inference calls', failLabel: 'skipped' },
  3: { label: 'raw poses returned', failLabel: 'empty' },
  4: { label: 'passed sanity filter', failLabel: 'rejected' },
  5: { label: 'confirmed tracks', failLabel: 'lost' },
  6: { label: 'keypoints above conf', failLabel: 'below' },
  7: { label: 'render frames drawn', failLabel: 'skipped' },
};

interface Sample {
  t: number;
  pass: boolean;
}

class RollingLog {
  private readonly samples: Sample[] = [];

  push(timestamp: number, pass: boolean) {
    this.samples.push({ t: timestamp, pass });
    this.prune(timestamp);
  }

  counts(timestamp: number) {
    this.prune(timestamp);
    let pass = 0;
    let fail = 0;
    this.samples.forEach((sample) => {
      if (sample.pass) pass += 1;
      else fail += 1;
    });
    return { pass, fail };
  }

  reset() {
    this.samples.length = 0;
  }

  private prune(timestamp: number) {
    while (
      this.samples.length &&
      timestamp - this.samples[0].t > PIPELINE_WINDOW_MS
    ) {
      this.samples.shift();
    }
  }
}

function dominantReason(reasons: RejectReasonCounts) {
  let best = '';
  let bestCount = 0;
  Object.entries(reasons).forEach(([reason, count]) => {
    if ((count ?? 0) > bestCount) {
      best = reason;
      bestCount = count ?? 0;
    }
  });
  return best;
}

function formatReasons(reasons: Record<string, number>) {
  const entries = Object.entries(reasons).filter(([, count]) => count > 0);
  if (!entries.length) return '';
  return `{${entries
    .sort((first, second) => second[1] - first[1])
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ')}}`;
}

export class PipelineHealthRecorder {
  private readonly logs: Record<PipelineLayerId, RollingLog> = {
    1: new RollingLog(),
    2: new RollingLog(),
    3: new RollingLog(),
    4: new RollingLog(),
    5: new RollingLog(),
    6: new RollingLog(),
    7: new RollingLog(),
  };

  private readonly landmarkLog = new RollingLog();
  private readonly rejectHistory: Array<{ t: number; reasons: RejectReasonCounts }> = [];
  private readonly reassociateHistory: Array<{ t: number; count: number }> = [];
  private readonly gapHistory: PipelineGap[] = [];

  private readyState = 0;
  private renderPeopleCount = 0;
  private scoreThreshold = 0;
  private currentBlame: PipelineBlame | null = null;
  private gapBlame: PipelineBlame | null = null;
  private lastVisibleAt: number | null = null;
  private firstVisibleAt: number | null = null;
  private sessionBlankGaps = 0;
  private sessionBlankMs = 0;
  private sessionByLayer: Record<string, number> = {};

  reportCapture(report: PipelineCaptureReport, timestamp = performance.now()) {
    this.readyState = report.readyState;
    const videoReady = report.readyState >= 2;
    this.logs[1].push(timestamp, videoReady);
    if (report.due) this.logs[2].push(timestamp, report.started);

    if (!videoReady) {
      this.currentBlame = {
        layer: 1,
        detail: `video.readyState ${report.readyState}`,
      };
      return;
    }
    if (report.due && !report.started) {
      this.currentBlame = { layer: 2, detail: 'inference tick skipped' };
    }
  }

  reportFrame(report: PipelineFrameReport, timestamp = performance.now()) {
    this.renderPeopleCount = report.renderPeopleCount;
    this.rejectHistory.push({ t: timestamp, reasons: report.rejectReasons });
    this.reassociateHistory.push({ t: timestamp, count: report.reassociatedCount });
    this.pruneFrameHistory(timestamp);

    const posesFound = report.rawPoseCount > 0;
    this.logs[3].push(timestamp, posesFound);
    if (!posesFound) {
      // Separate "the model saw nothing" from "the model saw something the
      // minPoseScore gate threw away" — the two need different fixes.
      const scored =
        report.modelPoseCount !== undefined && report.modelPoseCount > 0
          ? `model ${report.modelPoseCount} pose(s), top score ${
              report.topPoseScore?.toFixed(2) ?? '—'
            } < minPoseScore ${report.minPoseScore?.toFixed(2) ?? '—'}`
          : 'model returned nothing';
      this.currentBlame = { layer: 3, detail: scored };
      return;
    }

    const sanityPassed = report.sanityAcceptedCount > 0;
    this.logs[4].push(timestamp, sanityPassed);
    if (!sanityPassed) {
      const reason = dominantReason(report.rejectReasons) || 'all poses rejected';
      this.currentBlame = {
        layer: 4,
        detail: `sanity: ${reason}${
          report.sanityDetail ? ` (${report.sanityDetail})` : ''
        }`,
      };
      return;
    }

    if (report.renderRequiresConfirmedTracks) {
      const confirmed = report.confirmedCount > 0;
      this.logs[5].push(timestamp, confirmed);
      if (!confirmed) {
        this.currentBlame = { layer: 5, detail: 'no confirmed track' };
        return;
      }
    } else {
      // Simple mode renders accepted people, so confirmation is informational.
      this.logs[5].push(timestamp, report.confirmedCount > 0);
    }

    const renderable = report.renderablePeopleCount > 0;
    this.logs[6].push(timestamp, renderable);
    if (!renderable) {
      this.currentBlame = { layer: 6, detail: 'every keypoint below threshold' };
      return;
    }

    this.currentBlame = null;
  }

  reportRender(report: PipelineRenderReport, timestamp = performance.now()) {
    const log = report.source === 'halo' ? this.logs[7] : this.landmarkLog;
    if (report.drawn > 0) log.push(timestamp, true);
    else if (report.available > 0) log.push(timestamp, false);

    // The skeleton canvas is what the operator watches disappear, so it — not
    // the halo — decides when a gap opens and closes.
    if (report.source !== 'landmarks') return;
    if (report.drawn > 0) {
      this.markVisible(timestamp);
      return;
    }
    this.markMissing(
      report.available > 0
        ? { layer: 7, detail: 'people present, nothing drawn' }
        : this.currentBlame ?? { layer: 7, detail: 'no frame data' },
    );
  }

  setScoreThreshold(threshold: number) {
    this.scoreThreshold = threshold;
  }

  snapshot(timestamp = performance.now()): PipelineHealthSnapshot {
    this.pruneFrameHistory(timestamp);
    const counts = (id: PipelineLayerId) => this.logs[id].counts(timestamp);
    const readyTicks = counts(1);
    const inference = counts(2);
    const raw = counts(3);
    const sanity = counts(4);
    const confirmed = counts(5);
    const keypoints = counts(6);
    const render = counts(7);
    const landmarks = this.landmarkLog.counts(timestamp);

    const failedReasons: Record<string, number> = {};
    this.rejectHistory.forEach((entry) => {
      Object.entries(entry.reasons).forEach(([reason, count]) => {
        failedReasons[reason] = (failedReasons[reason] ?? 0) + (count ?? 0);
      });
    });
    const reassociated = this.reassociateHistory.reduce(
      (total, entry) => total + entry.count,
      0,
    );

    const layers: PipelineLayerSnapshot[] = [
      {
        id: 1,
        ...LAYER_META[1],
        value: String(this.readyState),
        failCount: readyTicks.fail,
        detail: `${readyTicks.pass + readyTicks.fail} ticks`,
      },
      {
        id: 2,
        ...LAYER_META[2],
        value: String(inference.pass),
        failCount: inference.fail,
        detail: '',
      },
      {
        id: 3,
        ...LAYER_META[3],
        value: String(raw.pass),
        failCount: raw.fail,
        detail: '',
      },
      {
        id: 4,
        ...LAYER_META[4],
        value: String(sanity.pass),
        failCount: sanity.fail,
        detail: formatReasons(failedReasons),
      },
      {
        id: 5,
        ...LAYER_META[5],
        value: String(confirmed.pass),
        failCount: confirmed.fail,
        detail: reassociated ? `grace reassoc: ${reassociated}` : '',
      },
      {
        id: 6,
        ...LAYER_META[6],
        value: String(keypoints.pass),
        failCount: keypoints.fail,
        detail: this.scoreThreshold
          ? `conf ≥ ${this.scoreThreshold.toFixed(2)} · ${this.renderPeopleCount} people`
          : '',
      },
      {
        id: 7,
        ...LAYER_META[7],
        value: String(render.pass),
        failCount: render.fail,
        detail: `skeleton canvas ${landmarks.pass}/${landmarks.fail}`,
      },
    ];

    const openGap = this.openGap(timestamp);
    return {
      windowMs: PIPELINE_WINDOW_MS,
      layers,
      lastGap: openGap ?? this.gapHistory[0] ?? null,
      gapHistory: [...this.gapHistory],
      session: {
        blankGaps: this.sessionBlankGaps,
        blankMs: this.sessionBlankMs,
        observedMs:
          this.firstVisibleAt === null
            ? 0
            : Math.max(0, timestamp - this.firstVisibleAt),
        byLayer: { ...this.sessionByLayer },
      },
    };
  }

  reset() {
    (Object.keys(this.logs) as unknown as PipelineLayerId[]).forEach((id) =>
      this.logs[id].reset(),
    );
    this.landmarkLog.reset();
    this.rejectHistory.length = 0;
    this.reassociateHistory.length = 0;
    this.gapHistory.length = 0;
    this.readyState = 0;
    this.renderPeopleCount = 0;
    this.currentBlame = null;
    this.gapBlame = null;
    this.lastVisibleAt = null;
    this.firstVisibleAt = null;
    this.sessionBlankGaps = 0;
    this.sessionBlankMs = 0;
    this.sessionByLayer = {};
  }

  private markVisible(timestamp: number) {
    if (this.lastVisibleAt !== null) {
      const durationMs = timestamp - this.lastVisibleAt;
      // No blame means no frame ever cleared the canvas: the skeleton froze on
      // its last pose rather than disappearing.
      const kind: PipelineGapKind = this.gapBlame ? 'blank' : 'stale';
      const threshold = kind === 'blank' ? GAP_MIN_MS : STALE_GAP_MIN_MS;
      if (durationMs >= threshold) {
        const blame = this.gapBlame ?? {
          layer: 7 as PipelineLayerId,
          detail: 'canvas not redrawn',
        };
        const gap: PipelineGap = {
          ...blame,
          kind,
          startedAt: this.lastVisibleAt,
          durationMs,
          open: false,
        };
        this.gapHistory.unshift(gap);
        if (this.gapHistory.length > GAP_HISTORY_SIZE) this.gapHistory.pop();
        if (kind === 'blank') {
          this.sessionBlankGaps += 1;
          this.sessionBlankMs += durationMs;
          const key = `L${gap.layer}`;
          this.sessionByLayer[key] = (this.sessionByLayer[key] ?? 0) + 1;
        }
        // The panel is unreadable from in front of the camera, so every gap
        // also lands in the console for a copy/paste after the session.
        console.info(
          `[pipeline-gap] t+${(gap.startedAt / 1000).toFixed(1)}s  ${String(
            Math.round(gap.durationMs),
          ).padStart(5)}ms  ${gap.kind.toUpperCase().padEnd(5)} L${
            gap.layer
          }  ${gap.detail}`,
        );
      }
    }
    this.firstVisibleAt ??= timestamp;
    this.lastVisibleAt = timestamp;
    this.gapBlame = null;
  }

  private markMissing(blame: PipelineBlame) {
    // The layer that broke the run is the one that failed first; later frames
    // in the same gap must not overwrite it.
    if (this.gapBlame === null) this.gapBlame = blame;
  }

  private openGap(timestamp: number): PipelineGap | null {
    if (this.lastVisibleAt === null) return null;
    const durationMs = timestamp - this.lastVisibleAt;
    const kind: PipelineGapKind = this.gapBlame ? 'blank' : 'stale';
    if (durationMs < (kind === 'blank' ? GAP_MIN_MS : STALE_GAP_MIN_MS)) {
      return null;
    }
    const blame =
      this.gapBlame ??
      this.currentBlame ?? { layer: 7 as PipelineLayerId, detail: 'no render report' };
    return {
      ...blame,
      kind,
      startedAt: this.lastVisibleAt,
      durationMs,
      open: true,
    };
  }

  private pruneFrameHistory(timestamp: number) {
    while (
      this.rejectHistory.length &&
      timestamp - this.rejectHistory[0].t > PIPELINE_WINDOW_MS
    ) {
      this.rejectHistory.shift();
    }
    while (
      this.reassociateHistory.length &&
      timestamp - this.reassociateHistory[0].t > PIPELINE_WINDOW_MS
    ) {
      this.reassociateHistory.shift();
    }
  }
}

export const pipelineHealth = new PipelineHealthRecorder();

export function formatGap(gap: PipelineGap | null) {
  if (!gap) return 'none';
  return `${Math.round(gap.durationMs)}ms ${gap.kind} at L${gap.layer} (${
    gap.detail
  })${gap.open ? ' — open' : ''}`;
}

export function formatGapHistory(gaps: PipelineGap[]) {
  if (!gaps.length) return 'none';
  return gaps
    .map(
      (gap) =>
        `${Math.round(gap.durationMs)}ms@L${gap.layer}${
          gap.kind === 'stale' ? '~' : ''
        }`,
    )
    .join(', ');
}

/** Plain-text dump of the panel, for pasting into a report. */
export function formatSession(session: PipelineHealthSnapshot['session']) {
  if (!session.observedMs) return 'no skeleton drawn yet';
  const lost = (session.blankMs / session.observedMs) * 100;
  const byLayer = Object.entries(session.byLayer)
    .sort((first, second) => second[1] - first[1])
    .map(([layer, count]) => `${layer}×${count}`)
    .join(' ');
  return `${session.blankGaps} blank gaps · ${(session.blankMs / 1000).toFixed(
    1,
  )}s lost of ${(session.observedMs / 1000).toFixed(0)}s (${lost.toFixed(
    0,
  )}%)${byLayer ? ` · ${byLayer}` : ''}`;
}

export function formatHealthReport(snapshot: PipelineHealthSnapshot) {
  const lines = [
    `PIPELINE HEALTH (${Math.round(snapshot.windowMs / 1000)}s)`,
    `SESSION: ${formatSession(snapshot.session)}`,
    ...snapshot.layers.map((entry) => {
      const head = `${entry.id}. ${entry.label}`.padEnd(26);
      const value = entry.value.padStart(5);
      const fail = `${entry.failLabel}: ${entry.failCount}`.padEnd(14);
      return `${head}${value}   ${fail}${entry.detail}`;
    }),
    '',
    `LAST GAP: ${formatGap(snapshot.lastGap)}`,
    `GAP HISTORY: ${formatGapHistory(snapshot.gapHistory)}`,
    '  (blank = skeleton vanished · stale = skeleton froze on its last pose)',
    ...snapshot.gapHistory.map(
      (gap) =>
        `  t+${(gap.startedAt / 1000).toFixed(1)}s  ${String(
          Math.round(gap.durationMs),
        ).padStart(5)}ms  ${gap.kind.toUpperCase().padEnd(5)} L${gap.layer}  ${
          gap.detail
        }`,
    ),
  ];
  return lines.join('\n');
}
