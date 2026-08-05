import assert from 'node:assert/strict';
import { interactionConfig } from '../config/interactionConfig';
import { WaveGestureRule } from '../gestures/WaveGestureRule';
import type { BodyKeypoints, PersonObservation } from '../perception/types';

interface PoseOptions {
  shoulderWidth?: number;
  wristNx?: number;
  wristRaised?: boolean;
}

function person({
  shoulderWidth = 0.2,
  wristNx = 0,
  wristRaised = true,
}: PoseOptions = {}): PersonObservation {
  const leftShoulderX = 0.5 - shoulderWidth / 2;
  const rightShoulderX = 0.5 + shoulderWidth / 2;
  const wristY = wristRaised ? 0.28 : 0.52;
  const visible = 0.95;
  const keypoints: BodyKeypoints = {
    nose: { x: 0.5, y: 0.2, z: 0, visibility: visible },
    leftShoulder: { x: leftShoulderX, y: 0.45, z: 0, visibility: visible },
    rightShoulder: { x: rightShoulderX, y: 0.45, z: 0, visibility: visible },
    leftElbow: { x: leftShoulderX, y: 0.34, z: 0, visibility: visible },
    leftWrist: {
      x: leftShoulderX + wristNx * shoulderWidth,
      y: wristY,
      z: 0,
      visibility: visible,
    },
    rightElbow: { x: rightShoulderX, y: 0.55, z: 0, visibility: visible },
    rightWrist: { x: rightShoulderX, y: 0.65, z: 0, visibility: visible },
    leftHip: { x: leftShoulderX, y: 0.68, z: 0, visibility: visible },
    rightHip: { x: rightShoulderX, y: 0.68, z: 0, visibility: visible },
  };
  return {
    id: 'stable-1',
    source: 'movenet',
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: 0.2,
      yMin: 0.15,
      xMax: 0.8,
      yMax: 0.9,
      width: 0.6,
      height: 0.75,
    },
    footPoint: { x: 0.5, y: 0.9 },
    centerX: 0.5,
    centerY: 0.5,
    visibleConfidence: visible,
  };
}

function feed(
  rule: WaveGestureRule,
  values: number[],
  shoulderWidth = 0.2,
  startMs = 0,
) {
  return values.map((wristNx, index) =>
    rule.update(
      person({ shoulderWidth, wristNx }),
      startMs + index * 100,
    ),
  );
}

const lowered = new WaveGestureRule().update(
  person({ wristRaised: false }),
  0,
);
assert.equal(lowered.active, false);
assert.equal(lowered.crossings, 0);

const stillStates = feed(new WaveGestureRule(), [0.12, 0.12, 0.12, 0.12]);
assert.equal(stillStates.at(-1)?.active, true);
assert.equal(stillStates.at(-1)?.crossings, 0);
assert.equal(stillStates.at(-1)?.confirmed, false);

const fullWave = feed(
  new WaveGestureRule(),
  [-0.175, 0.175, -0.175, 0.175],
);
assert.ok((fullWave.at(-1)?.crossings ?? 0) >= 2);
assert.ok(Math.abs((fullWave.at(-1)?.amplitude ?? 0) - 0.35) < 1e-9);
assert.equal(fullWave.at(-1)?.confirmed, true);

const jitter = feed(
  new WaveGestureRule(),
  [-0.05, 0.05, -0.05, 0.05],
);
assert.ok((jitter.at(-1)?.amplitude ?? 0) <= 0.1 + Number.EPSILON);
assert.equal(jitter.at(-1)?.confirmed, false);

const crossingsWithoutAmplitude = feed(
  new WaveGestureRule(),
  [-0.1, 0.1, -0.1, 0.1],
);
assert.ok((crossingsWithoutAmplitude.at(-1)?.crossings ?? 0) >= 2);
assert.ok(
  (crossingsWithoutAmplitude.at(-1)?.amplitude ?? 0) <
    interactionConfig.waveGesture.minAmplitude,
);
assert.equal(crossingsWithoutAmplitude.at(-1)?.confirmed, false);

const near = feed(new WaveGestureRule(), [-0.2, 0.2, -0.2, 0.2], 0.2);
const far = feed(new WaveGestureRule(), [-0.2, 0.2, -0.2, 0.2], 0.1);
assert.ok(
  Math.abs((near.at(-1)?.amplitude ?? 0) - (far.at(-1)?.amplitude ?? 0)) <
    1e-9,
  'Shoulder-width normalization keeps amplitude invariant with distance',
);

const releaseRule = new WaveGestureRule();
const confirmed = feed(
  releaseRule,
  [-0.2, 0.2, -0.2, 0.2],
).at(-1);
assert.equal(confirmed?.confirmed, true);
const released = releaseRule.update(
  person({ wristNx: 0.2 }),
  (confirmed?.lastCrossingAt ?? 0) +
    interactionConfig.waveGesture.releaseTimeoutMs +
    1,
);
assert.equal(released.released, true);
assert.equal(released.confirmed, false);

console.log('Wave gesture tests passed.');
