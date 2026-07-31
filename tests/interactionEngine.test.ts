import assert from 'node:assert/strict';
import type {
  BodyKeypoints,
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';
import { evaluateRaiseArm } from '../gestures/GestureRules';
import { GestureStabilityTracker } from '../gestures/GestureStabilityTracker';
import { InteractionStateMachine } from '../interaction/InteractionStateMachine';
import { ZoneTracker } from '../interaction/ZoneTracker';
import {
  scoreSecondaryDimensions,
  selectSecondaryDimension,
} from '../interaction/SecondaryRuleEngine';
import type { BehaviorFeatures } from '../behavior/types';
import { interactionConfig } from '../config/interactionConfig';

function person(
  id: string,
  footY = 0.82,
  raised = false,
): PersonObservation {
  const keypoints: BodyKeypoints = {
    nose: { x: 0.5, y: 0.2, z: 0, visibility: 1 },
    leftShoulder: { x: 0.43, y: 0.38, z: 0, visibility: 1 },
    rightShoulder: { x: 0.57, y: 0.38, z: 0, visibility: 1 },
    leftElbow: {
      x: 0.39,
      y: raised ? 0.27 : 0.5,
      z: 0,
      visibility: 1,
    },
    rightElbow: { x: 0.61, y: 0.5, z: 0, visibility: 1 },
    leftWrist: {
      x: 0.36,
      y: raised ? 0.12 : 0.6,
      z: 0,
      visibility: 1,
    },
    rightWrist: { x: 0.64, y: 0.6, z: 0, visibility: 1 },
    leftHip: { x: 0.46, y: 0.62, z: 0, visibility: 1 },
    rightHip: { x: 0.54, y: 0.62, z: 0, visibility: 1 },
    leftKnee: { x: 0.46, y: 0.72, z: 0, visibility: 1 },
    rightKnee: { x: 0.54, y: 0.72, z: 0, visibility: 1 },
    leftAnkle: { x: 0.46, y: footY, z: 0, visibility: 1 },
    rightAnkle: { x: 0.54, y: footY, z: 0, visibility: 1 },
  };
  return {
    id,
    source: 'movenet',
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: 0.35,
      yMin: 0.12,
      xMax: 0.65,
      yMax: footY,
      width: 0.3,
      height: footY - 0.12,
    },
    footPoint: { x: 0.5, y: footY },
    centerX: 0.5,
    centerY: 0.5,
    visibleConfidence: 1,
  };
}

function frame(timestamp: number, people: PersonObservation[]): PerceptionFrame {
  return {
    timestamp,
    people,
    hands: [],
    engine: 'movenet',
    fps: 24,
    inferenceMs: 20,
  };
}

const raised = evaluateRaiseArm([person('person-1', 0.82, true)]);
assert.equal(raised.satisfied, true, 'A clearly raised arm is accepted');
assert.equal(raised.initiatorId, 'person-1');
assert.equal(raised.arm, 'left');

const groupGesture = evaluateRaiseArm([
  person('person-1'),
  person('person-2', 0.82, true),
  person('person-3'),
]);
assert.equal(
  groupGesture.initiatorId,
  'person-2',
  'Any one group member can become the initiator',
);

const tracker = new GestureStabilityTracker();
assert.equal(tracker.update(true, true, 1000).confirmed, false);
assert.equal(tracker.update(true, true, 1600).confirmed, false);
assert.equal(
  tracker.update(true, true, 1800).confirmed,
  true,
  'A single frame must never confirm a gesture',
);

const zoneTracker = new ZoneTracker();
zoneTracker.update(frame(0, [person('person-1')]));
const captureCandidate = zoneTracker.update(
  frame(600, [person('person-1')]),
);
assert.equal(captureCandidate.capturePeople.length, 1);
const stableCapture = zoneTracker.update(frame(1150, [person('person-1')]));
assert.equal(stableCapture.activeStable, true);
assert.deepEqual(stableCapture.activeIds, ['person-1']);

assert.equal(
  interactionConfig.zones.approximateForwardStepMeters,
  0.5,
  'The demo spatial preset communicates an approximately half-meter step',
);
const threeZoneTracker = new ZoneTracker();
threeZoneTracker.update(frame(0, [person('zone-person', 0.55)]));
const engaged = threeZoneTracker.update(
  frame(600, [person('zone-person', 0.55)]),
);
assert.equal(
  engaged.engagedPeople.length,
  1,
  'The middle band establishes Z1 engagement without starting capture',
);
assert.equal(engaged.capturePeople.length, 0);
threeZoneTracker.update(frame(1200, [person('zone-person', 0.76)]));
const steppedForward = threeZoneTracker.update(
  frame(1800, [person('zone-person', 0.76)]),
);
assert.equal(
  steppedForward.capturePeople.length,
  1,
  'Crossing the configured demo capture line establishes Z2',
);

const overflowTracker = new ZoneTracker();
const sixPeople = Array.from({ length: 6 }, (_, index) =>
  person(`person-${index + 1}`),
);
overflowTracker.update(frame(0, sixPeople));
const overflow = overflowTracker.update(frame(600, sixPeople));
assert.equal(overflow.overflow, true);
assert.equal(
  overflow.activePeople.length,
  0,
  'Overflow never silently selects five of six people',
);

const machine = new InteractionStateMachine();
machine.dispatch('CAPTURE_ZONE_ENTERED');
assert.equal(machine.getState(), 'CAPTURE_ZONE');
machine.dispatch('START_DIRECT');
assert.equal(machine.getState(), 'DIRECT');
machine.dispatch('START_COUNTDOWN');
assert.equal(
  machine.getState(),
  'DIRECT',
  'Countdown cannot start directly from gesture direction',
);
machine.dispatch('GESTURE_CONFIRMED');
assert.equal(machine.getState(), 'POSE_READY');
machine.dispatch('START_COUNTDOWN');
assert.equal(machine.getState(), 'COUNTDOWN');
machine.dispatch('CAPTURE_INVALID');
assert.equal(
  machine.getState(),
  'CAPTURE_ZONE',
  'Leaving or changing the group cancels countdown',
);

const baseFeatures: BehaviorFeatures = {
  personCount: 3,
  armsOpen: false,
  handsConverged: true,
  handsTowardCenter: false,
  peopleClose: true,
  groupCohesion: 0.94,
  movementIntensity: 0.05,
  movementSynchrony: 0.86,
  spatialExploration: 0,
  stability: 0.92,
  poseReady: false,
  allSubjectsInFrame: true,
  detectionStable: true,
};
const collaborationScores = scoreSecondaryDimensions(baseFeatures);
assert.equal(
  selectSecondaryDimension(collaborationScores).dimension,
  'Collaboration',
);

console.log('Interaction engine rule tests passed.');
