import assert from 'node:assert/strict';
import type {
  BodyKeypoints,
  Landmark,
  PersonObservation,
} from '../perception/types';
import { poseSanityFilter } from '../perception/PoseSanityFilter';

const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 1080;

function point(x: number, y: number, confidence = 0.8): Landmark {
  return { x, y, z: 0, visibility: confidence };
}

function person(options: {
  shoulderWidthPx?: number;
  torsoPx?: number;
  centerX?: number;
  validExtras?: number;
  missing?: keyof BodyKeypoints;
  coreConfidences?: [number, number, number, number];
} = {}): PersonObservation {
  const shoulderWidth = (options.shoulderWidthPx ?? 105) / FRAME_WIDTH;
  const torso = (options.torsoPx ?? 145) / FRAME_HEIGHT;
  const centerX = options.centerX ?? 0.5;
  const shoulderY = 0.32;
  const hipY = shoulderY + torso;
  const confidences = options.coreConfidences ?? [0.8, 0.8, 0.8, 0.8];
  const keypoints: BodyKeypoints = {
    leftShoulder: point(
      centerX - shoulderWidth / 2,
      shoulderY,
      confidences[0],
    ),
    rightShoulder: point(
      centerX + shoulderWidth / 2,
      shoulderY,
      confidences[1],
    ),
    leftHip: point(centerX - shoulderWidth * 0.35, hipY, confidences[2]),
    rightHip: point(centerX + shoulderWidth * 0.35, hipY, confidences[3]),
  };
  const extras: Array<keyof BodyKeypoints> = [
    'nose',
    'leftElbow',
    'rightElbow',
    'leftKnee',
    'rightKnee',
    'leftAnkle',
    'rightAnkle',
  ];
  extras.slice(0, options.validExtras ?? extras.length).forEach((name, index) => {
    keypoints[name] = point(centerX, shoulderY + 0.02 * index, 0.8);
  });
  if (options.missing) delete keypoints[options.missing];
  return {
    id: 'raw-1',
    rawTrackId: 'raw-1',
    source: 'movenet',
    poseLandmarks: Object.values(keypoints).filter(
      (value): value is Landmark => Boolean(value),
    ),
    keypoints,
    bounds: {
      xMin: centerX - 0.08,
      xMax: centerX + 0.08,
      yMin: shoulderY - 0.1,
      yMax: hipY + 0.25,
      width: 0.16,
      height: torso + 0.35,
    },
    footPoint: { x: centerX, y: hipY + 0.25 },
    centerX,
    centerY: (shoulderY + hipY) / 2,
    visibleConfidence: 0.8,
  };
}

// `rejectDetail` carries diagnostic numbers that vary with the fixture, so
// rejections are asserted on pass/reason rather than the whole result object.
function assertReject(
  result: ReturnType<typeof poseSanityFilter>,
  rejectReason: string,
) {
  assert.equal(result.pass, false);
  assert.equal(result.rejectReason, rejectReason);
  assert.ok(result.rejectDetail, `${rejectReason} reports its measurements`);
}

assert.deepEqual(poseSanityFilter(person(), FRAME_WIDTH, FRAME_HEIGHT), {
  pass: true,
});

assertReject(
  poseSanityFilter(
    person({ shoulderWidthPx: 1.1 }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  'too_small',
);

assertReject(
  poseSanityFilter(
    person({ torsoPx: 55.5 }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  'too_small',
);

assertReject(
  poseSanityFilter(
    person({ validExtras: 0 }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  'few_keypoints',
);

assertReject(
  poseSanityFilter(
    person({ missing: 'leftHip' }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  'missing_core',
);

assertReject(
  poseSanityFilter(
    person({ centerX: 0.02 }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  'out_of_roi',
);

assert.deepEqual(
  poseSanityFilter(
    person({
      torsoPx: 145,
      shoulderWidthPx: 105,
      coreConfidences: [0.72, 0.77, 0.82, 0.86],
    }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  { pass: true },
  'Measured real-person geometry must not be rejected',
);

assert.deepEqual(
  poseSanityFilter(
    person({ torsoPx: 146.68, shoulderWidthPx: 40.763 }),
    FRAME_WIDTH,
    FRAME_HEIGHT,
  ),
  { pass: true },
  'The narrowest replayed static_near real-person frame must pass',
);

console.log('Pose sanity filter tests passed.');
