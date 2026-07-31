import assert from 'node:assert/strict';
import { evaluateGesture } from '../gestures/GestureRules';
import { GestureStabilityTracker } from '../gestures/GestureStabilityTracker';
import { InteractionStateMachine } from '../interaction/InteractionStateMachine';
import {
  scoreSecondaryDimensions,
  selectSecondaryDimension,
} from '../interaction/SecondaryRuleEngine';
import type { BehaviorFeatures } from '../behavior/types';

const baseFeatures: BehaviorFeatures = {
  personCount: 1,
  armsOpen: false,
  handsConverged: false,
  handsTowardCenter: false,
  peopleClose: false,
  groupCohesion: 0.5,
  movementIntensity: 0.05,
  movementSynchrony: undefined,
  spatialExploration: 0,
  stability: 0.92,
  poseReady: false,
  allSubjectsInFrame: true,
  detectionStable: true,
};

const singleRule = evaluateGesture('Single', {
  ...baseFeatures,
  armsOpen: true,
});
assert.equal(singleRule.satisfied, true, 'Single mode requires ARMS_OPEN');

const pairRule = evaluateGesture('Pair', {
  ...baseFeatures,
  personCount: 2,
  peopleClose: true,
  handsConverged: true,
  groupCohesion: 0.8,
});
assert.equal(
  pairRule.satisfied,
  true,
  'Pair mode requires proximity and converged hands',
);

const tracker = new GestureStabilityTracker();
assert.equal(tracker.update(true, true, 1000).confirmed, false);
assert.equal(tracker.update(true, true, 1250).confirmed, false);
assert.equal(
  tracker.update(true, true, 1400).confirmed,
  true,
  'A single frame must never confirm a gesture',
);

const machine = new InteractionStateMachine();
machine.dispatch('START');
machine.dispatch('PRIMARY_SELECTED');
machine.dispatch('ANALYSIS_COMPLETE');
machine.dispatch('RESPONSE_COMPLETE');
machine.dispatch('INSTRUCTION_SHOWN');
assert.equal(machine.getState(), 'ACTION_TRACKING');
machine.dispatch('START_COUNTDOWN');
assert.equal(
  machine.getState(),
  'ACTION_TRACKING',
  'Countdown cannot start directly from gesture tracking',
);
machine.dispatch('GESTURE_CONFIRMED');
assert.equal(machine.getState(), 'POSE_READY');
machine.dispatch('START_COUNTDOWN');
assert.equal(machine.getState(), 'COUNTDOWN');

const collaborationScores = scoreSecondaryDimensions({
  ...baseFeatures,
  personCount: 3,
  groupCohesion: 0.94,
  handsConverged: true,
  movementSynchrony: 0.86,
});
assert.equal(
  selectSecondaryDimension(collaborationScores).dimension,
  'Collaboration',
);

console.log('Interaction engine rule tests passed.');
