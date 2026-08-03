import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';
import type { TrackScaleReading } from '../interaction/PersonTrackStore';
import { recordRenderTiming } from '../perception/RenderTimingStore';
import { interactionConfig } from '../config/interactionConfig';

const HISTORY_WINDOW_MS = 30_000;
const STATS_WINDOW_MS = 5_000;

interface Props {
  snapshot: InteractionEngineSnapshot;
}

interface RecordedReading {
  frameIndex: number;
  label: string;
  reading: TrackScaleReading;
}

function display(value: number | null, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function minConfidence(...values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

function csvCell(value: string | number | boolean | null) {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvNumber(value: number | null, digits = 6) {
  return value === null ? null : Number(value.toFixed(digits));
}

function downloadCsv(rows: RecordedReading[]) {
  const headers = [
    'timestamp_ms',
    'frame_idx',
    'track_id',
    'stable_track_id',
    'label',
    'raw_scale',
    'med_scale',
    'filt_scale',
    'baseline',
    'g',
    'g_velocity',
    'credit',
    'baseline_frozen',
    'baseline_init_count',
    'zone_proxy',
    'torso',
    'shoulder_width',
    'conf_ls',
    'conf_rs',
    'conf_lh',
    'conf_rh',
    'scale_null',
    'null_reason',
    'foot_y_norm',
    'existing_zone',
    'active_count',
    'fps',
    'inference_ms',
    'capture_ms',
    'infer_ms',
    'post_ms',
    'render_ms',
    'total_ms',
    'rejected_count',
    'reject_reasons',
    'posture_valid',
    'posture_reason',
    'posture_invalid_ms',
  ];
  const lines = rows.map(({ frameIndex, label, reading }) => {
    const blankScale = reading.scaleNull;
    const values: Array<string | number | boolean | null> = [
      Number(reading.timestampMs.toFixed(3)),
      frameIndex,
      reading.trackId,
      reading.stableTrackId,
      label,
      blankScale ? null : csvNumber(reading.rawScale),
      blankScale ? null : csvNumber(reading.medScale),
      blankScale ? null : csvNumber(reading.filtScale),
      blankScale ? null : csvNumber(reading.baseline),
      blankScale ? null : csvNumber(reading.g),
      blankScale ? null : csvNumber(reading.gVelocity),
      csvNumber(reading.credit),
      blankScale ? null : reading.baselineFrozen,
      reading.baselineInitCount,
      reading.zoneProxy,
      blankScale ? null : csvNumber(reading.torso),
      blankScale ? null : csvNumber(reading.shoulderWidth),
      csvNumber(reading.confLs),
      csvNumber(reading.confRs),
      csvNumber(reading.confLh),
      csvNumber(reading.confRh),
      reading.scaleNull,
      reading.nullReason,
      csvNumber(reading.footYNorm),
      reading.existingZone,
      reading.activeCount,
      reading.fps,
      csvNumber(reading.inferenceMs, 3),
      csvNumber(reading.captureMs, 3),
      csvNumber(reading.inferMs, 3),
      csvNumber(reading.postMs, 3),
      csvNumber(reading.renderMs, 3),
      csvNumber(reading.totalMs, 3),
      reading.rejectedCount,
      JSON.stringify(reading.rejectReasons),
      reading.postureValid,
      reading.postureReason,
      csvNumber(reading.postureInvalidForMs, 3),
    ];
    return values.map(csvCell).join(',');
  });
  const csv = [headers.join(','), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  link.href = url;
  link.download = `body-scale-probe-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function rollingStats(history: TrackScaleReading[], now: number) {
  const values = history
    .filter((point) => now - point.timestampMs <= STATS_WINDOW_MS)
    .map((point) => point.g)
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return {
    mean,
    sigma: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function drawChart(
  canvas: HTMLCanvasElement,
  history: TrackScaleReading[],
  now: number,
) {
  const renderStarted = performance.now();
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(
    window.devicePixelRatio || 1,
    2,
    1280 / Math.max(1, bounds.width),
  );
  const pixelWidth = Math.max(1, Math.round(bounds.width * ratio));
  const pixelHeight = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(4, 12, 17, .92)';
  context.fillRect(0, 0, width, height);

  const left = 44;
  const right = width - 12;
  const scaleTop = 24;
  const scaleBottom = Math.max(scaleTop + 30, height * 0.48);
  const gainTop = scaleBottom + 32;
  const gainBottom = height - 23;
  const xAt = (timestamp: number) =>
    left +
    ((timestamp - (now - HISTORY_WINDOW_MS)) / HISTORY_WINDOW_MS) *
      (right - left);

  context.font = '10px "Courier New", monospace';
  context.fillStyle = 'rgba(223, 248, 255, .68)';
  context.fillText('SCALE (PX)', 8, 13);
  context.fillText('g + FOOT Y (FOOT MAPPED 0.85–1.35)', 8, gainTop - 9);

  if (!history.length) {
    context.fillStyle = 'rgba(223, 248, 255, .5)';
    context.fillText('Waiting for tracked body-scale samples…', left, height / 2);
    recordRenderTiming('probeChart', performance.now() - renderStarted);
    return;
  }

  const scaleValues = history.flatMap((point) =>
    [point.rawScale, point.filtScale, point.baseline].filter(
      (value): value is number => value !== null,
    ),
  );
  let scaleMin = scaleValues.length ? Math.min(...scaleValues) : 0;
  let scaleMax = scaleValues.length ? Math.max(...scaleValues) : 1;
  const scalePad = Math.max((scaleMax - scaleMin) * 0.12, 1);
  scaleMin -= scalePad;
  scaleMax += scalePad;
  const scaleY = (value: number) =>
    scaleBottom -
    ((value - scaleMin) / Math.max(scaleMax - scaleMin, 1e-6)) *
      (scaleBottom - scaleTop);
  const gainY = (value: number) =>
    gainBottom - ((value - 0.85) / 0.5) * (gainBottom - gainTop);

  context.strokeStyle = 'rgba(223, 248, 255, .12)';
  context.lineWidth = 1;
  [scaleTop, scaleBottom, gainTop, gainBottom].forEach((y) => {
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  });
  context.fillStyle = 'rgba(223, 248, 255, .45)';
  context.fillText(scaleMax.toFixed(1), 4, scaleTop + 4);
  context.fillText(scaleMin.toFixed(1), 4, scaleBottom + 3);
  context.fillText('1.35', 8, gainTop + 4);
  context.fillText('0.85', 8, gainBottom + 3);
  context.fillText('-30s', left, height - 7);
  context.fillText('now', right - 20, height - 7);

  const plot = (
    valueOf: (point: TrackScaleReading) => number | null,
    yOf: (value: number) => number,
    color: string,
    lineWidth: number,
    dash: number[] = [],
  ) => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.beginPath();
    let active = false;
    history.forEach((point) => {
      const value = valueOf(point);
      if (value === null) {
        active = false;
        return;
      }
      const x = xAt(point.timestampMs);
      const y = yOf(value);
      if (active) context.lineTo(x, y);
      else context.moveTo(x, y);
      active = true;
    });
    context.stroke();
    context.setLineDash([]);
  };

  plot((point) => point.rawScale, scaleY, 'rgba(191, 225, 235, .55)', 1);
  plot((point) => point.filtScale, scaleY, '#7bd5ef', 2.4);
  plot((point) => point.baseline, scaleY, '#ffd56a', 1.5, [6, 4]);

  context.strokeStyle = 'rgba(255, 255, 255, .28)';
  context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(left, gainY(1));
  context.lineTo(right, gainY(1));
  context.stroke();
  context.setLineDash([]);
  [
    [interactionConfig.zoneThresholds.enterZ2Growth, '#6dff9c'],
    [interactionConfig.zoneThresholds.exitZ2Growth, '#ffd56a'],
  ].forEach(([threshold, color]) => {
    context.strokeStyle = color;
    context.globalAlpha = 0.62;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(left, gainY(Number(threshold)));
    context.lineTo(right, gainY(Number(threshold)));
    context.stroke();
  });
  context.globalAlpha = 1;
  context.setLineDash([]);
  plot((point) => point.g, gainY, '#ffffff', 2.4);
  plot(
    (point) => 0.85 + Math.max(0, Math.min(1, point.footYNorm)) * 0.5,
    gainY,
    '#ff7fb8',
    1.3,
  );

  const legend = [
    ['raw', 'rgba(191, 225, 235, .8)'],
    ['filt', '#7bd5ef'],
    ['base', '#ffd56a'],
    ['g', '#ffffff'],
    ['foot', '#ff7fb8'],
  ] as const;
  let legendX = Math.max(left, right - 210);
  legend.forEach(([label, color]) => {
    context.fillStyle = color;
    context.fillRect(legendX, 7, 12, 2);
    context.fillText(label, legendX + 16, 12);
    legendX += 42;
  });
  recordRenderTiming('probeChart', performance.now() - renderStarted);
}

export default function BodyScaleProbePanel({ snapshot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historiesRef = useRef(new Map<string, TrackScaleReading[]>());
  const lastTimestampRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const recordedRowsRef = useRef<RecordedReading[]>([]);
  const frameIndexRef = useRef(0);
  const labelRef = useRef('');
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [label, setLabel] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState(0);

  const readings = snapshot.bodyScaleProbe?.readings ?? [];
  const currentTrackId =
    selectedTrackId && historiesRef.current.has(selectedTrackId)
      ? selectedTrackId
      : (readings[0]?.stableTrackId ?? '');
  const now = snapshot.frame?.timestamp ?? performance.now();

  useEffect(() => {
    const timestamp = snapshot.frame?.timestamp;
    if (
      timestamp === undefined ||
      timestamp === lastTimestampRef.current ||
      !snapshot.bodyScaleProbe
    ) {
      return;
    }
    lastTimestampRef.current = timestamp;
    snapshot.bodyScaleProbe.readings.forEach((reading) => {
      const history = historiesRef.current.get(reading.stableTrackId) ?? [];
      history.push(reading);
      historiesRef.current.set(
        reading.stableTrackId,
        history.filter(
          (point) => timestamp - point.timestampMs <= HISTORY_WINDOW_MS,
        ),
      );
    });
    historiesRef.current.forEach((history, trackId) => {
      const recent = history.filter(
        (point) => timestamp - point.timestampMs <= HISTORY_WINDOW_MS,
      );
      if (recent.length) historiesRef.current.set(trackId, recent);
      else historiesRef.current.delete(trackId);
    });
    if (!selectedTrackId && snapshot.bodyScaleProbe.readings[0]) {
      setSelectedTrackId(snapshot.bodyScaleProbe.readings[0].stableTrackId);
    }
    if (recordingRef.current) {
      frameIndexRef.current += 1;
      const frameIndex = frameIndexRef.current;
      snapshot.bodyScaleProbe.readings.forEach((reading) => {
        recordedRowsRef.current.push({
          frameIndex,
          label: labelRef.current,
          reading,
        });
      });
      setRecordedFrames(frameIndex);
    }
  }, [selectedTrackId, snapshot.bodyScaleProbe, snapshot.frame?.timestamp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(
      canvas,
      historiesRef.current.get(currentTrackId) ?? [],
      now,
    );
  }, [currentTrackId, now]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    downloadCsv(recordedRowsRef.current);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recordingRef.current) {
      stopRecording();
      return;
    }
    recordedRowsRef.current = [];
    frameIndexRef.current = 0;
    setRecordedFrames(0);
    recordingRef.current = true;
    setRecording(true);
  }, [stopRecording]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key.toLowerCase() === 'r' &&
        target?.tagName !== 'INPUT' &&
        target?.tagName !== 'TEXTAREA'
      ) {
        event.preventDefault();
        toggleRecording();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleRecording]);

  const stats = useMemo(
    () => rollingStats(historiesRef.current.get(currentTrackId) ?? [], now),
    [currentTrackId, now],
  );
  const sanity = snapshot.bodyScaleProbe?.sanity;
  const rejectSummary = sanity
    ? Object.entries(sanity.rejectReasons)
        .map(([reason, count]) => `${reason} ${count}`)
        .join(' | ')
    : '';

  return (
    <section className="body-scale-probe" aria-label="Body scale shadow probe">
      <div className="probe-track-list">
        {readings.map((reading) => {
          const shoulderConf = minConfidence(reading.confLs, reading.confRs);
          const hipConf = minConfidence(reading.confLh, reading.confRh);
          return (
            <button
              type="button"
              className={`probe-track-card ${
                currentTrackId === reading.stableTrackId ? 'selected' : ''
              }`}
              key={reading.stableTrackId}
              onClick={() => setSelectedTrackId(reading.stableTrackId)}
            >
              <strong>RAW {reading.trackId}</strong>
              <span>stable <b>{reading.stableTrackId}</b></span>
              <span>raw <b>{display(reading.rawScale)}</b></span>
              <span>filt <b>{display(reading.filtScale)}</b></span>
              <span>base <b>{display(reading.baseline)}</b></span>
              <span className="probe-g">g <b>{display(reading.g, 3)}</b></span>
              <span>proxy <b>{reading.zoneProxy}</b></span>
              <span>credit <b>{reading.credit.toFixed(3)}</b></span>
              <span>
                vote
                <b
                  className="probe-credit-ring"
                  role="progressbar"
                  aria-valuemin={-1}
                  aria-valuemax={1}
                  aria-valuenow={reading.credit}
                  style={{
                    background: `conic-gradient(#7bd5ef ${Math.abs(reading.credit) * 100}%, rgba(255,255,255,.14) 0)`,
                  }}
                />
              </span>
              <span>
                conf <b>S {display(shoulderConf, 2)} / H {display(hipConf, 2)}</b>
              </span>
              <span>zone <b>{reading.existingZone}</b></span>
              <span>foot_y <b>{reading.footYNorm.toFixed(4)}</b></span>
              <span>posture <b>{reading.postureReason}</b></span>
              <span>
                drop <b>{reading.nullFrameCount} / {reading.totalFrameCount}</b>
              </span>
            </button>
          );
        })}
      </div>

      <div className="probe-sanity">
        <strong>
          REJECTED (10s): {sanity?.rejectedCount ?? 0}
          {rejectSummary ? ` · ${rejectSummary}` : ''}
        </strong>
        <span>
          ACCEPTED: {sanity?.acceptedCount ?? 0} · UNCONFIRMED:{' '}
          {sanity?.unconfirmedCount ?? 0}
        </span>
        <span>
          DIRECTION CHECK: {snapshot.bodyScaleProbe?.directionMismatches ?? 0} /
          {snapshot.bodyScaleProbe?.directionComparisons ?? 0} MISMATCH
        </span>
        <span className="probe-thresholds">
          PROXY {interactionConfig.zoneProxy} · ENTER g ≥{' '}
          {interactionConfig.zoneThresholds.enterZ2Growth.toFixed(3)} · EXIT g ≤{' '}
          {interactionConfig.zoneThresholds.exitZ2Growth.toFixed(3)} · DWELL{' '}
          {interactionConfig.dwell.enterSeconds.toFixed(1)}s /{' '}
          {interactionConfig.dwell.exitSeconds.toFixed(1)}s
        </span>
      </div>

      <div className="probe-recorder">
        <label>
          LABEL
          <input
            value={label}
            disabled={recording}
            onChange={(event) => {
              labelRef.current = event.target.value;
              setLabel(event.target.value);
            }}
            placeholder="static_1p"
          />
        </label>
        <button type="button" onClick={toggleRecording}>
          {recording ? 'STOP + DOWNLOAD' : 'RECORD (R)'}
        </button>
        <strong className={recording ? 'is-recording' : ''}>
          {recording ? '● REC' : '○ IDLE'} · {recordedFrames} FRAMES
        </strong>
      </div>

      <div className="probe-chart-panel">
        <div className="probe-chart-title">
          <strong>30S SHADOW SIGNAL · {currentTrackId || 'NO TRACK'}</strong>
          <span>CLICK A PERSON CARD TO SELECT</span>
        </div>
        <canvas ref={canvasRef} className="probe-chart" />
        <div className="probe-stats">
          {stats
            ? `g: mean ${stats.mean.toFixed(3)}  σ ${stats.sigma.toFixed(4)}  min ${stats.min.toFixed(3)}  max ${stats.max.toFixed(3)}`
            : 'g: waiting for 5-second rolling samples'}
        </div>
      </div>
    </section>
  );
}
