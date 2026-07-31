import React, { useEffect, useRef } from 'react';
import type { CameraStatus } from '../camera/CameraService';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';
import type { BodyJoint } from '../perception/types';

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
  }, [snapshot.frame, snapshot.initiatorId]);

  const { features, secondaryScores, zones } = snapshot;
  return (
    <div className="perception-debug" aria-label="Perception developer overlay">
      <canvas ref={canvasRef} className="landmark-canvas" />
      <aside className="debug-console">
        <div className="debug-title">
          <strong>{snapshot.frame?.engine.toUpperCase() ?? 'VISION'} ENGINE</strong>
          <span>{snapshot.perception.status}</span>
        </div>
        <dl>
          <dt>STATE</dt><dd>{snapshot.state}</dd>
          <dt>CAMERA</dt><dd>{cameraStatus}</dd>
          <dt>FPS / INFERENCE</dt>
          <dd>{snapshot.frame?.fps ?? 0} / {snapshot.frame?.inferenceMs.toFixed(0) ?? '—'}ms</dd>
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
