import React, { useEffect, useRef } from 'react';
import type { CameraStatus } from '../camera/CameraService';
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import { handGesture, simpleModeGesture } from '../config/simpleMode';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';
import type { BodyJoint, FrameTiming } from '../perception/types';
import { pipelineHealth } from '../perception/PipelineHealthStore';
import { recordRenderTiming } from '../perception/RenderTimingStore';
import {
  createVideoViewportMapping,
} from '../utils/viewportTransform';
import BodyScaleProbePanel from './BodyScaleProbePanel';
import PipelineHealthPanel from './PipelineHealthPanel';

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
  videoRef: React.RefObject<HTMLVideoElement | null>;
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
  videoRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timingHistoryRef = useRef<Array<{ timestamp: number; timing: FrameTiming }>>([]);
  const lastTimingTimestampRef = useRef<number | null>(null);
  const tensorBaselineRef = useRef<{ timestamp: number; count: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
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
    if (!frame) {
      pipelineHealth.reportRender({
        source: 'landmarks',
        available: 0,
        drawn: 0,
      });
      return;
    }
    const transform = createVideoViewportMapping(video, bounds, true);
    const point = transform.point;

    let peopleDrawn = 0;
    frame.people.forEach((person) => {
      if (Object.values(person.keypoints).some(Boolean)) peopleDrawn += 1;
      context.strokeStyle =
        snapshot.initiatorId === person.id ? '#FFFFFF' : '#7BD5EF';
      context.fillStyle = context.strokeStyle;
      context.lineWidth = 1.5;
      BODY_CONNECTIONS.forEach(([start, end]) => {
        const first = person.keypoints[start];
        const second = person.keypoints[end];
        if (!first || !second) return;
        const firstScreen = point(first.x, first.y);
        const secondScreen = point(second.x, second.y);
        context.beginPath();
        context.moveTo(firstScreen.x, firstScreen.y);
        context.lineTo(secondScreen.x, secondScreen.y);
        context.stroke();
      });
      Object.values(person.keypoints).forEach((landmark) => {
        if (!landmark) return;
        const screen = point(landmark.x, landmark.y);
        context.beginPath();
        context.arc(
          screen.x,
          screen.y,
          2.5,
          0,
          Math.PI * 2,
        );
        context.fill();
      });

      const nose = person.keypoints.nose;
      if (nose?.coordinateTrace) {
        const screen = transform.videoPoint(
          nose.coordinateTrace.video.x,
          nose.coordinateTrace.video.y,
        );
        context.save();
        context.strokeStyle = '#ff3348';
        context.fillStyle = '#ff3348';
        context.lineWidth = 2;
        context.shadowColor = '#ff3348';
        context.shadowBlur = 10;
        context.beginPath();
        context.moveTo(screen.x - 14, screen.y);
        context.lineTo(screen.x + 14, screen.y);
        context.moveTo(screen.x, screen.y - 14);
        context.lineTo(screen.x, screen.y + 14);
        context.stroke();
        context.shadowBlur = 0;
        context.font = '700 10px "Courier New", monospace';
        const labelOnLeft = screen.x > bounds.width - 360;
        context.textAlign = labelOnLeft ? 'right' : 'left';
        const labelX = labelOnLeft ? screen.x - 18 : screen.x + 18;
        const { roi, video: videoCoordinate } = nose.coordinateTrace;
        context.fillText(
          `NOSE ROI ${roi.x.toFixed(1)},${roi.y.toFixed(1)}`,
          labelX,
          screen.y - 18,
        );
        context.fillText(
          `VIDEO ${videoCoordinate.x.toFixed(1)},${videoCoordinate.y.toFixed(1)}`,
          labelX,
          screen.y - 6,
        );
        context.fillText(
          `SCREEN ${screen.x.toFixed(1)},${screen.y.toFixed(1)}`,
          labelX,
          screen.y + 6,
        );
        context.restore();
      }
    });
    pipelineHealth.reportRender({
      source: 'landmarks',
      available: frame.people.length,
      drawn: peopleDrawn,
    });
    recordRenderTiming('landmarks', performance.now() - renderStarted);
  }, [snapshot.frame, snapshot.initiatorId, videoRef]);

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
      <div
        className={`debug-blocked-by ${snapshot.blockedBy ? 'is-blocked' : 'is-clear'}`}
        role="status"
      >
        BLOCKED BY:{' '}
        {snapshot.blockedBy
          ? `${snapshot.blockedBy.condition} (${snapshot.blockedBy.reason})`
          : 'NONE'}
      </div>
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
        <PipelineHealthPanel />
        <dl>
          <dt>SIMPLE MODE</dt>
          <dd>{snapshot.simpleFlow ? 'ON' : 'OFF'}</dd>
          <dt>STATE</dt><dd>{snapshot.state}</dd>
          {snapshot.simpleFlow && (
            <>
              <dt>HELD</dt>
              <dd>{(snapshot.simpleFlow.heldMs / 1000).toFixed(1)}s</dd>
              <dt>RING</dt>
              <dd>
                {snapshot.simpleFlow.ringProgress.toFixed(2)} · base{' '}
                {snapshot.simpleFlow.baseRatePerSec.toFixed(2)}/s +boost{' '}
                {snapshot.simpleFlow.boostRatePerSec.toFixed(2)}/s
              </dd>
              <dt>HAND RAISED</dt>
              <dd>
                {snapshot.simpleFlow.handRaised
                  ? `yes (${snapshot.simpleFlow.handSide})`
                  : 'no'}
              </dd>
              <dt>GESTURE</dt>
              <dd>
                wave {snapshot.wave?.crossings ?? 0}/
                {simpleModeGesture.waveMinCrossings} amp{' '}
                {(snapshot.wave?.amplitude ?? 0).toFixed(2)} · raiseArm{' '}
                {(snapshot.gesture?.matchScore ?? 0).toFixed(2)}
              </dd>
              <dt>PERSON LATCH</dt>
              <dd>
                {String(snapshot.simpleFlow.personPresent)} (last seen{' '}
                {snapshot.simpleFlow.lastSeenAgoMs === null
                  ? '—'
                  : `${(snapshot.simpleFlow.lastSeenAgoMs / 1000).toFixed(1)}s`}{' '}
                ago)
              </dd>
              <dt>HAND</dt>
              <dd>
                {snapshot.handGesture?.status === 'not-installed'
                  ? 'HAND MODEL NOT INSTALLED'
                  : snapshot.handGesture?.status === 'error'
                    ? 'HAND MODEL UNAVAILABLE'
                    : snapshot.handGesture?.status === 'loading'
                      ? 'HAND MODEL LOADING'
                      : snapshot.handGesture
                        ? `${snapshot.handGesture.category ?? '—'} ${snapshot.handGesture.confidence.toFixed(2)} stable ${snapshot.handGesture.stableCount}/${snapshot.handGesture.stableTarget} · ${snapshot.handGesture.crop ? `crop ${snapshot.handGesture.crop.inputSize}px @ (${snapshot.handGesture.crop.sourceX},${snapshot.handGesture.crop.sourceY})` : snapshot.handGesture.gated ? 'crop pending' : 'gated off'} · INF ${snapshot.handGesture.inferenceMs === null ? '—' : `${snapshot.handGesture.inferenceMs.toFixed(1)}ms`} · runs ${snapshot.handGesture.inferenceCount}/${handGesture.recognizeHz}Hz`
                        : 'OFF'}
              </dd>
            </>
          )}
          <dt>DEMO MODE</dt><dd>{interactionConfig.demoMode.enabled ? 'ON' : 'OFF'}</dd>
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
          <dt>WAVE</dt>
          <dd>
            {snapshot.wave
              ? `${snapshot.wave.side ?? '—'} · crossings ${snapshot.wave.crossings}/${effectiveInteractionConfig.waveMinCrossings} · amp ${snapshot.wave.amplitude.toFixed(2)} · ${Math.round(snapshot.wave.progress * 100)}%`
              : '—'}
          </dd>
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
