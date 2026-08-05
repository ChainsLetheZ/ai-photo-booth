import assert from 'node:assert/strict';
import type { PersonObservation } from '../perception/types';
import { mapPeopleToPortraitTrace } from '../services/poseTrace';
import { getCoverSourceRect } from '../utils/viewportTransform';

function close(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

const person: PersonObservation = {
  id: 'stable-1',
  source: 'movenet',
  poseLandmarks: [],
  keypoints: {
    nose: { x: 0.5, y: 0.375, z: 0, visibility: 0.95 },
    leftShoulder: { x: 0.4, y: 0.5, z: 0, visibility: 0.9 },
    rightShoulder: { x: 0.6, y: 0.5, z: 0, visibility: 0.9 },
    leftHip: { x: 0.43, y: 0.7, z: 0, visibility: 0.85 },
    rightHip: { x: 0.57, y: 0.7, z: 0, visibility: 0.85 },
  },
  bounds: { xMin: 0.4, yMin: 0.375, xMax: 0.6, yMax: 0.7, width: 0.2, height: 0.325 },
  footPoint: { x: 0.5, y: 0.7 },
  centerX: 0.5,
  centerY: 0.55,
  visibleConfidence: 0.9,
};

const cover = getCoverSourceRect(1440, 1080, 1920, 1080);
const traces = mapPeopleToPortraitTrace(
  [person],
  1440,
  1080,
  cover,
  'stable-1',
);
assert.equal(traces.length, 1);
assert.equal(traces[0].isInitiator, true);
assert.equal(traces[0].keypoints.length, 5);
assert.ok(traces[0].hullPoints.length >= 3);
const nose = traces[0].keypoints.find((point) => point.name === 'nose');
assert.ok(nose);
close(nose.x, 0.5);
const photoHeightRatio = 675 / (675 + 490);
close(nose.y, (270 / 810) * photoHeightRatio);

console.log('Pose trace capture mapping tests passed.');
