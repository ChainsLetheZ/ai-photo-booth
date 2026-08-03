import assert from 'node:assert/strict';
import type {
  BodyKeypoints,
  Landmark,
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';
import { PersonTrackStore } from '../interaction/PersonTrackStore';
import { ZoneTracker } from '../interaction/ZoneTracker';

const WIDTH = 1440;
const HEIGHT = 1080;

function point(x: number, y: number): Landmark {
  return { x, y, z: 0, visibility: 0.9 };
}

function person(
  rawTrackId: string,
  options: { centerX?: number; scaleFactor?: number; footY?: number } = {},
): PersonObservation {
  const centerX = options.centerX ?? 0.5;
  const factor = options.scaleFactor ?? 1;
  const shoulderWidth = (105 * factor) / WIDTH;
  const torso = (145 * factor) / HEIGHT;
  const shoulderY = 0.28;
  const hipY = shoulderY + torso;
  const footY = options.footY ?? 0.58;
  const keypoints: BodyKeypoints = {
    nose: point(centerX, shoulderY - 0.12),
    leftShoulder: point(centerX - shoulderWidth / 2, shoulderY),
    rightShoulder: point(centerX + shoulderWidth / 2, shoulderY),
    leftElbow: point(centerX - shoulderWidth * 0.7, shoulderY + 0.08),
    rightElbow: point(centerX + shoulderWidth * 0.7, shoulderY + 0.08),
    leftWrist: point(centerX - shoulderWidth * 0.8, shoulderY + 0.17),
    rightWrist: point(centerX + shoulderWidth * 0.8, shoulderY + 0.17),
    leftHip: point(centerX - shoulderWidth * 0.35, hipY),
    rightHip: point(centerX + shoulderWidth * 0.35, hipY),
    leftKnee: point(centerX - shoulderWidth * 0.3, (hipY + footY) / 2),
    rightKnee: point(centerX + shoulderWidth * 0.3, (hipY + footY) / 2),
    leftAnkle: point(centerX - shoulderWidth * 0.25, footY),
    rightAnkle: point(centerX + shoulderWidth * 0.25, footY),
  };
  return {
    id: rawTrackId,
    rawTrackId,
    source: 'movenet',
    poseScore: 0.9,
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: centerX - 0.09,
      xMax: centerX + 0.09,
      yMin: shoulderY - 0.14,
      yMax: footY,
      width: 0.18,
      height: footY - shoulderY + 0.14,
    },
    footPoint: { x: centerX, y: footY },
    centerX,
    centerY: (shoulderY + hipY) / 2,
    visibleConfidence: 0.9,
  };
}

function frame(timestamp: number, people: PersonObservation[]): PerceptionFrame {
  return {
    timestamp,
    people,
    hands: [],
    engine: 'movenet',
    fps: 20,
    inferenceMs: 45,
  };
}

function confirm(
  store: PersonTrackStore,
  zoneTracker: ZoneTracker,
  rawId = 'raw-a',
  options: Parameters<typeof person>[1] = {},
) {
  let latestReading = null as ReturnType<PersonTrackStore['measure']> | null;
  let stabilized = frame(0, []);
  for (let index = 0; index < 5; index += 1) {
    stabilized = store.stabilize(
      frame(index * 50, [person(rawId, options)]),
      WIDTH,
      HEIGHT,
    ).frame;
    if (index < 4) {
      assert.equal(stabilized.people.length, 0);
      assert.equal(
        store.measure(stabilized, zoneTracker.update(stabilized), WIDTH, HEIGHT)
          .readings.length,
        0,
        'Unconfirmed tracks must not create a baseline reading',
      );
    } else {
      const zones = zoneTracker.update(stabilized);
      latestReading = store.measure(stabilized, zones, WIDTH, HEIGHT);
    }
  }
  assert.equal(stabilized.people.length, 1);
  assert.ok(latestReading?.readings[0].baseline !== null);
  return {
    stableTrackId: stabilized.people[0].id,
    baseline: latestReading!.readings[0].baseline,
  };
}

const confirmationStore = new PersonTrackStore();
confirm(confirmationStore, new ZoneTracker());

const farZoneTracker = new ZoneTracker();
farZoneTracker.update(frame(0, [person('zone-far', { footY: 0.55 })]));
const farZone = farZoneTracker.update(
  frame(600, [person('zone-far', { footY: 0.55 })]),
);
assert.equal(farZone.readings[0].stableZone, 'ENGAGED');
const nearZoneTracker = new ZoneTracker();
nearZoneTracker.update(frame(0, [person('zone-near', { footY: 0.76 })]));
const nearZone = nearZoneTracker.update(
  frame(600, [person('zone-near', { footY: 0.76 })]),
);
assert.equal(
  nearZone.readings[0].stableZone,
  'CAPTURE_ZONE',
  'Increasing foot_y_norm must move the existing classifier toward Z2',
);

const reassociationStore = new PersonTrackStore();
const reassociationZones = new ZoneTracker();
const original = confirm(reassociationStore, reassociationZones);
reassociationStore.stabilize(frame(250, []), WIDTH, HEIGHT);
const reassociatedFrame = reassociationStore.stabilize(
  frame(500, [person('raw-b')]),
  WIDTH,
  HEIGHT,
).frame;
assert.equal(reassociatedFrame.people[0].id, original.stableTrackId);
const reassociatedReading = reassociationStore.measure(
  reassociatedFrame,
  reassociationZones.update(reassociatedFrame),
  WIDTH,
  HEIGHT,
).readings[0];
assert.equal(reassociatedReading.baseline, original.baseline);
assert.equal(reassociatedReading.trackId, 'raw-b');

const expiredStore = new PersonTrackStore();
const expiredZones = new ZoneTracker();
const expiredOriginal = confirm(expiredStore, expiredZones);
expiredStore.stabilize(frame(250, []), WIDTH, HEIGHT);
let expiredFrame = frame(0, []);
for (let index = 0; index < 5; index += 1) {
  expiredFrame = expiredStore.stabilize(
    frame(1000 + index * 50, [person('raw-new')]),
    WIDTH,
    HEIGHT,
  ).frame;
}
assert.notEqual(expiredFrame.people[0].id, expiredOriginal.stableTrackId);

const distantStore = new PersonTrackStore();
const distantZones = new ZoneTracker();
const distantOriginal = confirm(distantStore, distantZones);
distantStore.stabilize(frame(250, []), WIDTH, HEIGHT);
let distantFrame = frame(0, []);
for (let index = 0; index < 5; index += 1) {
  distantFrame = distantStore.stabilize(
    frame(500 + index * 50, [person('raw-distant', { centerX: 0.8 })]),
    WIDTH,
    HEIGHT,
  ).frame;
}
assert.notEqual(distantFrame.people[0].id, distantOriginal.stableTrackId);

const scaleStore = new PersonTrackStore();
const scaleZones = new ZoneTracker();
const scaleOriginal = confirm(scaleStore, scaleZones);
scaleStore.stabilize(frame(250, []), WIDTH, HEIGHT);
let scaleFrame = frame(0, []);
for (let index = 0; index < 5; index += 1) {
  scaleFrame = scaleStore.stabilize(
    frame(500 + index * 50, [person('raw-large', { scaleFactor: 1.4 })]),
    WIDTH,
    HEIGHT,
  ).frame;
}
assert.notEqual(scaleFrame.people[0].id, scaleOriginal.stableTrackId);

const filterStore = new PersonTrackStore();
const filterZones = new ZoneTracker();
const filterOriginal = confirm(filterStore, filterZones);
filterStore.stabilize(frame(250, []), WIDTH, HEIGHT);
const filterFrame = filterStore.stabilize(
  frame(500, [person('raw-filter', { scaleFactor: 1.1 })]),
  WIDTH,
  HEIGHT,
).frame;
assert.equal(filterFrame.people[0].id, filterOriginal.stableTrackId);
const filterReading = filterStore.measure(
  filterFrame,
  filterZones.update(filterFrame),
  WIDTH,
  HEIGHT,
).readings[0];
assert.notEqual(
  filterReading.filtScale,
  filterReading.rawScale,
  'Reassociated tracks must retain OneEuroFilter history',
);

const directionStore = new PersonTrackStore();
const directionZones = new ZoneTracker();
confirm(directionStore, directionZones, 'far', { footY: 0.55 });
directionStore.reset();
directionZones.reset();
const near = confirm(directionStore, directionZones, 'near', { footY: 0.76 });
assert.ok(near.baseline !== null);

console.log('Track stability tests passed.');
