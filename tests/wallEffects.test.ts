import assert from 'node:assert/strict';
import { driftPlacement, hashUnit } from '../services/wallDrift';
import { fitPoseToCell, leadFigure } from '../services/wallPoseFigure';
import type { PoseTrace } from '../types';


const trace = (
  overrides: Partial<Record<string, { x: number; y: number; score: number }>> = {},
  isInitiator = false,
): PoseTrace => {
  const base: Record<string, { x: number; y: number; score: number }> = {
    leftShoulder: { x: 0.42, y: 0.3, score: 0.9 },
    rightShoulder: { x: 0.58, y: 0.3, score: 0.9 },
    leftElbow: { x: 0.38, y: 0.4, score: 0.9 },
    leftWrist: { x: 0.36, y: 0.5, score: 0.9 },
    leftHip: { x: 0.45, y: 0.5, score: 0.9 },
    rightHip: { x: 0.55, y: 0.5, score: 0.9 },
    ...overrides,
  };
  const keypoints = Object.entries(base).map(([name, point]) => ({
    name,
    ...point,
  }));
  return {
    keypoints,
    hullPoints: keypoints.map(({ x, y }) => ({ x, y })),
    isInitiator,
  };
};

const figure = fitPoseToCell(trace());
assert.ok(figure, 'A usable pose must produce a figure');
assert.ok(figure!.bones.length >= 4, 'Connected joints must become bones');
const coords = [...figure!.joints, ...figure!.hull];
assert.ok(
  coords.every(
    (point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
  ),
  'The refitted figure must stay inside the cell',
);
const spanX = Math.max(...figure!.joints.map((p) => p.x)) -
  Math.min(...figure!.joints.map((p) => p.x));
const spanY = Math.max(...figure!.joints.map((p) => p.y)) -
  Math.min(...figure!.joints.map((p) => p.y));
assert.ok(
  Math.max(spanX, spanY) > 0.7,
  'The figure must fill the cell rather than sit in a corner',
);

assert.equal(
  fitPoseToCell({ keypoints: [], hullPoints: [], isInitiator: false }),
  null,
  'A pose with no usable joints must not render',
);
assert.equal(
  fitPoseToCell(
    trace({
      leftShoulder: { x: 0.42, y: 0.3, score: 0.05 },
      rightShoulder: { x: 0.58, y: 0.3, score: 0.05 },
      leftElbow: { x: 0.38, y: 0.4, score: 0.05 },
      leftWrist: { x: 0.36, y: 0.5, score: 0.05 },
      leftHip: { x: 0.45, y: 0.5, score: 0.05 },
      rightHip: { x: 0.55, y: 0.5, score: 0.05 },
    }),
  ),
  null,
  'Low-confidence joints must not be drawn as if they were seen',
);

const lead = leadFigure([trace(), trace({}, true)]);
assert.ok(lead, 'The initiator provides the figure when the capture had one');

assert.equal(
  hashUnit('entry-a'),
  hashUnit('entry-a'),
  'Drift must be stable so a floating tile does not twitch between renders',
);
assert.notEqual(hashUnit('entry-a'), hashUnit('entry-b'));

for (const total of [1, 6, 40, 200]) {
  const placements = Array.from({ length: total }, (_, index) =>
    driftPlacement(`entry-${index}`, index, total),
  );
  assert.ok(
    placements.every(
      (point) =>
        point.x >= 0.06 && point.x <= 0.94 && point.y >= 0.06 && point.y <= 0.94,
    ),
    `Drifting tiles must stay on the wall at ${total} photos`,
  );
  if (total >= 6) {
    const spanX =
      Math.max(...placements.map((p) => p.x)) -
      Math.min(...placements.map((p) => p.x));
    assert.ok(
      spanX > 0.3,
      `Photos must spread across the wall at ${total}, not clump at the centre`,
    );
  }
}

const drift = driftPlacement('entry-0', 0, 10);
assert.ok(
  drift.periodMs >= 9000 && drift.periodMs <= 15000,
  'Drift period stays in the configured range',
);
assert.ok(drift.delayMs <= 0, 'A negative delay starts each tile mid-drift');

console.log('Wall effect tests passed.');
