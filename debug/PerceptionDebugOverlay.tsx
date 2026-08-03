import React, { useEffect, useRef } from 'react';
import type { CameraStatus } from '../camera/CameraService';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';
import type { BodyJoint, FrameTiming } from '../perception/types';
import { recordRenderTiming } from '../perception/RenderTimingStore';
import BodyScaleProbePanel from './BodyScaleProbePanel';

const BODY_CONNECTIONS: Array<[BodyJoint, BodyJoint]> = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

interface Props {
  snapshot: InteractionEngineSnapshot;
  cameraStatus: CameraStatus;
}

const TIMING_WINDOW_MS = 5_000;

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianTiming(samples: FrameTiming[]): FrameTiming | null {
  if (!samples.length) return null;
  return {
    captureMs: median(samples.map((sample) => sample.captureMs)) ?? 0,
    inferMs: median(samples.map((sample) => sample.inferMs)) ?? 0,
    postMs: median(samples.map((sample) => sample.postMs)) ?? 0,
    renderMs: median(samples.map((sample) => sample.renderMs)) ?? 0,
    totalMs: median(samples.map((sample) => sample.totalMs)) ?? 0,
  };
}

function score(value: number | undefined) {
  return value === undefined ? '—' : value.toFixed(2);
}

export default function PerceptionDebugOverlay({
  snapshot,
  cameraStatus,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timingHistoryRef = useRef<Array<{ timestamp: number; timing: FrameTiming }>>([]);
  const lastTimingTimestampRef = useRef<number | null>(null);
  const tensorBaselineRef = useRef<{ timestamp: number; count: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    context.clearRect(0, 0, bounds.width, bounds.height);
    const frame = snapshot.frame;
    if (!frame) return;

    frame.people.forEach((person) => {
      context.strokeStyle =
        snapshot.initiatorId === person.id ? '#FFFFFF' : '#7BD5EF';
      context.fillStyle = context.strokeStyle;
      context.lineWidth = 1.5;
      BODY_CONNECTIONS.forEach(([start, end]) => {
        const first = person.keypoints[start];
        const second = person.keypoints[end];
        if (!first || !second) return;
        context.beginPath();
        context.moveTo((1 - first.x) * bounds.width, first.y * bounds.height);
        context.lineTo((1 - second.x) * bounds.width, second.y * bounds.height);
        context.stroke();
      });
      Object.values(person.keypoints).forEach((landmark) => {
        if (!landmark) return;
        context.beginPath();
        context.arc(
          (1 - landmark.x) * bounds.width,
          landmark.y * bounds.height,
          2.5,
          0,
          Math.PI * 2,
        );
        context.fill();
      });
    });
    recordRenderTiming('landmarks', performance.now() - renderStarted);
  }, [snapshot.frame, snapshot.initiatorId]);

  const { features, secondaryScores, zones } = snapshot;
  const timing = snapshot.frame?.timing;
  const timingTimestamp = snapshot.frame?.timestamp;
  if (
    timing &&
    timingTimestamp !== undefined &&
    timingTimestamp !== lastTimingTimestampRef.current
  ) {
    lastTimingTimestampRef.current = timingTimestamp;
    timingHistoryRef.current.push({ timestamp: timingTimestamp, timing });
    timingHistoryRef.current = timingHistoryRef.current.filter(
      (sample) => timingTimestamp - sample.timestamp <= TIMING_WINDOW_MS,
    );
  }
  const timingMedian = medianTiming(
    timingHistoryRef.current.map((sample) => sample.timing),
  );
  const webglFlags = snapshot.frame?.diagnostics?.webglFlags;
  const tensorCount = snapshot.frame?.diagnostics?.numTensors;
  if (timingTimestamp !== undefined && tensorCount !== undefined && tensorCount !== null) {
    if (
      tensorBaselineRef.current === null ||
      tensorCount < tensorBaselineRef.current.count
    ) {
      tensorBaselineRef.current = { timestamp: timingTimestamp, count: tensorCount };
    }
  }
  const tensorBaseline = tensorBaselineRef.current;
  const tensorAgeSeconds =
    tensorBaseline && timingTimestamp !== undefined
      ? Math.max(0, timingTimestamp - tensorBaseline.timestamp) / 1000
      : null;
  const tensorDelta =
    tensorBaseline && tensorCount !== undefined && tensorCount !== null
      ? tensorCount - tensorBaseline.count
      : null;
  return (
    <div className="perception-debug" aria-label="Perception developer overlay">
      <canvas ref={canvasRef} className="landmark-canvas" />
      {snapshot.bodyScaleProbe && <BodyScaleProbePanel snapshot={snapshot} />}
      <aside className="debug-console">
        <div className="debug-title">
          <strong>{snapshot.frame?.engine.toUpperCase() ?? 'VISION'} ENGINE</strong>
          <span>{snapshot.perception.status}</span>
        </div>
        <div className="debug-frame-timing" data-testid="frame-timing">
          CAP {timing?.captureMs.toFixed(1) ?? '—'} / INF{' '}
          {timing?.inferMs.toFixed(1) ?? '—'} / POST{' '}
          {timing?.postMs.toFixed(1) ?? '—'} / RENDER{' '}
          {timing?.renderMs.toFixed(1) ?? '—'} / TOTAL{' '}
          {timing?.totalMs.toFixed(1) ?? '—'} ms
          <small data-testid="frame-timing-median">
            MEDIAN CAP {timingMedian?.captureMs.toFixed(1) ?? '—'} / INF{' '}
            {timingMedian?.inferMs.toFixed(1) ?? '—'} / POST{' '}
            {timingMedian?.postMs.toFixed(1) ?? '—'} / RENDER{' '}
            {timingMedian?.renderMs.toFixed(1) ?? '—'} / TOTAL{' '}
            {timingMedian?.totalMs.toFixed(1) ?? '—'} ms
          </small>
        </div>
        <dl>
          <dt>STATE</dt><dd>{snapshot.state}</dd>
          <dt>CAMERA</dt><dd>{cameraStatus}</dd>
          <dt>FPS / INFERENCE</dt>
          <dd>{snapshot.frame?.fps ?? 0} / {snapshot.frame?.inferenceMs.toFixed(0) ?? '—'}ms</dd>
          <dt>BACKEND / TENSORS</dt>
          <dd>
            {snapshot.frame?.diagnostics?.backend ?? '—'} /{' '}
            {snapshot.frame?.diagnostics?.numTensors ?? '—'}
          </dd>
          <dt>TENSOR Δ / AGE</dt>
          <dd data-testid="tensor-stability">
            {tensorDelta ?? '—'} /{' '}
            {tensorAgeSeconds === null ? '—' : `${tensorAgeSeconds.toFixed(0)}s`}
          </dd>
          <dt>ROI INPUT / MAX POSES</dt>
          <dd>
            {snapshot.frame?.diagnostics
              ? `${snapshot.frame.diagnostics.roiInputWidth}×${snapshot.frame.diagnostics.roiInputHeight}`
              : '—'}{' '}
            / {snapshot.frame?.diagnostics?.maxPoses ?? '—'}
          </dd>
          <dt>MODEL</dt>
          <dd>{snapshot.frame?.diagnostics?.modelType ?? '—'}</dd>
          <dt>WEBGL FLAGS</dt>
          <dd>
            {webglFlags
              ? Object.entries(webglFlags)
                  .map(([name, value]) => `${name.replace('WEBGL_', '')}:${String(value)}`)
                  .join(' / ')
              : '—'}
          </dd>
          <dt>VISIBLE / ENGAGED</dt>
          <dd>{zones.visiblePeople.length} / {zones.engagedPeople.length}</dd>
          <dt>CAPTURE / ACTIVE</dt>
          <dd>{zones.capturePeople.length} / {zones.activePeople.length}</dd>
          <dt>OVERFLOW / STABLE</dt>
          <dd>{String(zones.overflow)} / {String(zones.activeStable)}</dd>
          <dt>MODE</dt><dd>{snapshot.mode}</dd>
          <dt>IN FRAME</dt><dd>{String(features.allSubjectsInFrame)}</dd>
          <dt>COHESION</dt><dd>{score(features.groupCohesion)}</dd>
          <dt>MOVEMENT</dt><dd>{score(features.movementIntensity)}</dd>
          <dt>INITIATOR</dt><dd>{snapshot.initiatorId ?? '—'}</dd>
          <dt>GESTURE SCORE</dt><dd>{score(snapshot.gesture?.matchScore)}</dd>
          <dt>HOLD</dt><dd>{Math.round(snapshot.stability.progress * 100)}%</dd>
          <dt>COUNTDOWN</dt><dd>{snapshot.countdown ?? '—'}</dd>
        </dl>
        <div className="debug-scores">
          <strong>SECONDARY SCORES</strong>
          {(['Collaboration', 'Precision', 'Momentum', 'Exploration'] as const).map(
            (dimension) => (
              <span key={dimension}>
                {dimension}
                <i>
                  <b style={{ width: `${(secondaryScores?.[dimension] ?? 0) * 100}%` }} />
                </i>
                {score(secondaryScores?.[dimension])}
              </span>
            ),
          )}
        </div>
        {snapshot.perception.warning && (
          <small>{snapshot.perception.warning}</small>
        )}
        {snapshot.perception.error && (
          <small>{snapshot.perception.error}</small>
        )}
      </aside>
    </div>
  );
}
