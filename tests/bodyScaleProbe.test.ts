import assert from 'node:assert/strict';
import {
  bodyScale,
  dist,
  MedianWindow,
  mid,
  OneEuroFilter,
  type Pt,
} from '../perception/BodyScaleProbe';
import {
  createTrackScaleState,
  updateScaleBaseline,
} from '../interaction/PersonTrackStore';

const origin = { x: 0, y: 0 };
const triangle = { x: 3, y: 4 };
assert.equal(dist(origin, triangle), 5);
assert.deepEqual(mid(origin, triangle), { x: 1.5, y: 2 });

const torso: Record<string, Pt | undefined> = {
  leftShoulder: { x: 0, y: 0, score: 0.9 },
  rightShoulder: { x: 6, y: 0, score: 0.9 },
  leftHip: { x: 0, y: 8, score: 0.9 },
  rightHip: { x: 6, y: 8, score: 0.9 },
};
const valid = bodyScale(torso, 0.3);
assert.equal(valid.reason, 'ok');
assert.equal(valid.torso, 8);
assert.equal(valid.shoulderWidth, 6);
assert.equal(valid.scale, 8);

const lowConfidence = bodyScale(
  {
    ...torso,
    leftHip: { x: 0, y: 8, score: 0.29 },
  },
  0.3,
);
assert.equal(lowConfidence.scale, null);
assert.equal(lowConfidence.reason, 'low_confidence');

const missing = bodyScale({ ...torso, rightHip: undefined }, 0.3);
assert.equal(missing.scale, null);
assert.equal(missing.reason, 'missing_keypoint');

const sideOn = bodyScale(
  {
    leftShoulder: { x: 4.995, y: 0, score: 0.9 },
    rightShoulder: { x: 5.005, y: 0, score: 0.9 },
    leftHip: { x: 4, y: 10, score: 0.9 },
    rightHip: { x: 6, y: 10, score: 0.9 },
  },
  0.3,
);
assert.ok(Math.abs((sideOn.scale ?? 0) - 10) < 1e-9);

const armsDown = bodyScale({
  ...torso,
  leftWrist: { x: 0, y: 12, score: 0.9 },
  rightWrist: { x: 6, y: 12, score: 0.9 },
});
const armsRaised = bodyScale({
  ...torso,
  leftWrist: { x: -100, y: -200, score: 0.9 },
  rightWrist: { x: 120, y: -180, score: 0.9 },
});
assert.equal(armsRaised.scale, armsDown.scale);

const median = new MedianWindow(3);
const medianOutputs = [100, 100, 300, 100].map((value) => median.push(value));
assert.deepEqual(medianOutputs, [100, 100, 100, 100]);

const constantFilter = new OneEuroFilter(0.8, 0.02, 1);
const constantOutputs = Array.from({ length: 100 }, (_, index) =>
  constantFilter.filter(42, index * 16.67),
);
assert.ok(constantOutputs.every((value) => Math.abs(value - 42) < 1e-9));

const stepFilter = new OneEuroFilter(0.8, 0.02, 1);
stepFilter.filter(0, 0);
const stepOutputs = Array.from({ length: 100 }, (_, index) =>
  stepFilter.filter(100, (index + 1) * 16.67),
);
assert.ok(stepOutputs.every((value) => value >= 0 && value <= 100));
assert.ok(
  stepOutputs.every(
    (value, index) => index === 0 || value >= stepOutputs[index - 1],
  ),
);
assert.ok(stepOutputs.at(-1)! > 99);

const baselineState = createTrackScaleState();
updateScaleBaseline(baselineState, 100, 'Z1');
const frozenBaseline = baselineState.baseline;
for (let frame = 0; frame < 100; frame += 1) {
  updateScaleBaseline(baselineState, 120, 'Z2');
}
assert.equal(baselineState.baseline, frozenBaseline);
assert.equal(baselineState.baselineFrozen, true);
assert.equal(baselineState.g, 1.2);

console.log('Body scale probe tests passed.');
