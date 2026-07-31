import React, { useEffect, useRef } from 'react';
import type { CameraStatus } from '../camera/CameraService';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
].map(([start, end]) => ({ start, end }));

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
].map(([start, end]) => ({ start, end }));

interface Props {
  snapshot: InteractionEngineSnapshot;
  cameraStatus: CameraStatus;
}

function score(value: number | undefined) {
  return value === undefined ? '—' : value.toFixed(2);
}

export default function PerceptionDebugOverlay({
  snapshot,
  cameraStatus,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const frame = snapshot.frame;
    if (!frame) return;

    const drawConnections = (
      landmarks: Array<{ x: number; y: number }>,
      connections: Array<{ start: number; end: number }>,
      color: string,
    ) => {
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      connections.forEach(({ start, end }) => {
        const first = landmarks[start];
        const second = landmarks[end];
        if (!first || !second) return;
        context.beginPath();
        context.moveTo(first.x * bounds.width, first.y * bounds.height);
        context.lineTo(second.x * bounds.width, second.y * bounds.height);
        context.stroke();
      });
      context.fillStyle = color;
      landmarks.forEach((landmark) => {
        context.beginPath();
        context.arc(
          landmark.x * bounds.width,
          landmark.y * bounds.height,
          2.4,
          0,
          Math.PI * 2,
        );
        context.fill();
      });
    };

    frame.people.forEach((person) =>
      drawConnections(
        person.poseLandmarks,
        POSE_CONNECTIONS,
        '#7BD5EF',
      ),
    );
    frame.hands.forEach((hand) =>
      drawConnections(
        hand.landmarks,
        HAND_CONNECTIONS,
        '#F5A623',
      ),
    );
  }, [snapshot.frame]);

  const { features, secondaryScores } = snapshot;
  return (
    <div className="perception-debug" aria-label="MediaPipe developer overlay">
      <canvas ref={canvasRef} className="landmark-canvas" />
      <aside className="debug-console">
        <div className="debug-title">
          <strong>MEDIAPIPE ENGINE</strong>
          <span>{snapshot.perception.status}</span>
        </div>
        <dl>
          <dt>STATE</dt><dd>{snapshot.state}</dd>
          <dt>CAMERA</dt><dd>{cameraStatus}</dd>
          <dt>FPS / INFERENCE</dt>
          <dd>{snapshot.frame?.fps ?? 0} / {snapshot.frame?.inferenceMs.toFixed(0) ?? '—'}ms</dd>
          <dt>PEOPLE / MODE</dt><dd>{features.personCount} / {snapshot.mode}</dd>
          <dt>ARMS OPEN</dt><dd>{String(features.armsOpen)}</dd>
          <dt>HANDS CONVERGED</dt><dd>{String(features.handsConverged)}</dd>
          <dt>PEOPLE CLOSE</dt><dd>{String(features.peopleClose)}</dd>
          <dt>IN FRAME / STABLE</dt>
          <dd>{String(features.allSubjectsInFrame)} / {String(features.detectionStable)}</dd>
          <dt>COHESION</dt><dd>{score(features.groupCohesion)}</dd>
          <dt>MOVEMENT</dt><dd>{score(features.movementIntensity)}</dd>
          <dt>SYNCHRONY</dt><dd>{score(features.movementSynchrony)}</dd>
          <dt>EXPLORATION</dt><dd>{score(features.spatialExploration)}</dd>
          <dt>GESTURE</dt><dd>{snapshot.gesture?.requiredPrimitive ?? '—'}</dd>
          <dt>HOLD</dt><dd>{Math.round(snapshot.stability.progress * 100)}%</dd>
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
        <p>
          {snapshot.primary ?? 'No primary'} × {snapshot.secondary ?? 'Pending'}
        </p>
        {snapshot.perception.error && (
          <small>{snapshot.perception.error}</small>
        )}
      </aside>
    </div>
  );
}
