import assert from 'node:assert/strict';
import { interactionConfig } from '../config/interactionConfig';
import { ZoneTracker } from '../interaction/ZoneTracker';
import type {
  BodyKeypoints,
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';

function person(id: string, torsoScaleRatio: number): PersonObservation {
  const keypoints: BodyKeypoints = {
    nose: { x: 0.5, y: 0.2, z: 0, visibility: 0.95 },
    leftShoulder: { x: 0.4, y: 0.35, z: 0, visibility: 0.95 },
    rightShoulder: { x: 0.6, y: 0.35, z: 0, visibility: 0.95 },
    leftHip: {
      x: 0.4 + torsoScaleRatio * 0.6,
      y: 0.35 + torsoScaleRatio * 0.8,
      z: 0,
      visibility: 0.95,
    },
    rightHip: {
      x: 0.6 + torsoScaleRatio * 0.6,
      y: 0.35 + torsoScaleRatio * 0.8,
      z: 0,
      visibility: 0.95,
    },
  };
  return {
    id,
    source: 'movenet',
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: 0.3,
      yMin: 0.2,
      xMax: 0.75,
      yMax: 0.75,
      width: 0.45,
      height: 0.55,
    },
    footPoint: { x: 0.5, y: 0.9 },
    centerX: 0.5,
    centerY: 0.5,
    visibleConfidence: 0.95,
  };
}

function frame(timestamp: number, people: PersonObservation[]): PerceptionFrame {
  return {
    timestamp,
    people,
    hands: [],
    engine: 'movenet',
    fps: 20,
    inferenceMs: 40,
  };
}

assert.equal(interactionConfig.zoneBypass.enabled, true);

const tracker = new ZoneTracker(true);
const accepted = person('stable-near', 0.12);
let snapshot = tracker.update(frame(0, [accepted]));
assert.equal(snapshot.readings[0].proxy, 'bypass');
assert.equal(snapshot.readings[0].stableZone, 'CAPTURE_ZONE');
assert.deepEqual(snapshot.activeIds, ['stable-near']);
assert.equal(snapshot.activeStable, false, 'Group settle timing remains enabled');
snapshot = tracker.update(frame(600, [accepted]));
assert.equal(snapshot.activeStable, true);

const distantTracker = new ZoneTracker(true);
const distant = person('stable-far', 0.099);
const distantSnapshot = distantTracker.update(frame(0, [distant]));
assert.equal(distantSnapshot.readings[0].stableZone, 'PASSERBY');
assert.equal(distantSnapshot.activePeople.length, 0);

const overflowTracker = new ZoneTracker(true);
const crowd = Array.from({ length: 6 }, (_, index) =>
  person(`stable-${index + 1}`, 0.12),
);
const overflowSnapshot = overflowTracker.update(frame(0, crowd));
assert.equal(overflowSnapshot.capturePeople.length, 6);
assert.equal(overflowSnapshot.overflow, true);
assert.equal(overflowSnapshot.activePeople.length, 0);

console.log('Zone bypass tests passed.');
