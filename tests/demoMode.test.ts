import assert from 'node:assert/strict';
import { subjectInFrameResult } from '../behavior/BehaviorFeatureExtractor';
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import { evaluateRaiseArm } from '../gestures/GestureRules';
import { GestureStabilityTracker } from '../gestures/GestureStabilityTracker';
import { WaveGestureRule } from '../gestures/WaveGestureRule';
import { PersonTrackStore } from '../interaction/PersonTrackStore';
import { InteractionStateMachine } from '../interaction/InteractionStateMachine';
import { ZoneTracker } from '../interaction/ZoneTracker';
import type {
  BodyKeypoints,
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';

function person(
  id: string,
  options: {
    wristNx?: number;
    wristY?: number;
    raised?: boolean;
    noseX?: number;
  } = {},
): PersonObservation {
  const leftShoulderX = 0.4;
  const rightShoulderX = 0.6;
  const shoulderWidth = rightShoulderX - leftShoulderX;
  const raised = options.raised ?? false;
  const keypoints: BodyKeypoints = {
    nose: { x: options.noseX ?? 0.5, y: 0.2, z: 0, visibility: 0.95 },
    leftShoulder: { x: leftShoulderX, y: 0.4, z: 0, visibility: 0.95 },
    rightShoulder: { x: rightShoulderX, y: 0.4, z: 0, visibility: 0.95 },
    leftElbow: { x: 0.38, y: raised ? 0.34 : 0.5, z: 0, visibility: 0.95 },
    rightElbow: { x: 0.62, y: 0.5, z: 0, visibility: 0.95 },
    leftWrist: {
      x: leftShoulderX + (options.wristNx ?? 0) * shoulderWidth,
      y: options.wristY ?? (raised ? 0.342 : 0.6),
      z: 0,
      visibility: 0.95,
    },
    rightWrist: { x: 0.64, y: 0.6, z: 0, visibility: 0.95 },
    leftHip: { x: 0.42, y: 0.5, z: 0, visibility: 0.95 },
    rightHip: { x: 0.62, y: 0.5, z: 0, visibility: 0.95 },
  };
  return {
    id,
    rawTrackId: id,
    source: 'movenet',
    poseScore: 0.95,
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: 0.3,
      yMin: 0.15,
      xMax: 0.7,
      yMax: 0.8,
      width: 0.4,
      height: 0.65,
    },
    footPoint: { x: 0.5, y: 0.8 },
    centerX: 0.5,
    centerY: 0.45,
    visibleConfidence: 0.95,
  };
}

function frame(timestamp: number, people: PersonObservation[]): PerceptionFrame {
  return {
    timestamp,
    people,
    hands: [],
    engine: 'movenet',
    fps: 7,
    inferenceMs: 40,
  };
}

assert.equal(interactionConfig.demoMode.enabled, true);
assert.equal(effectiveInteractionConfig.trackConfirmFrames, 2);
assert.equal(effectiveInteractionConfig.minPersonScaleRatio, 0.06);
assert.equal(effectiveInteractionConfig.activeGroupStableMs, 0);
assert.equal(effectiveInteractionConfig.preGestureDelayMs, 0);
assert.equal(effectiveInteractionConfig.raiseArmScoreThreshold, 0.55);
assert.equal(effectiveInteractionConfig.raiseArmHoldMs, 500);
assert.equal(effectiveInteractionConfig.waveMinAmplitude, 0.22);
assert.equal(effectiveInteractionConfig.postGestureDelayMs, 0);
assert.equal(effectiveInteractionConfig.countdownAllowIdChange, true);
assert.equal(effectiveInteractionConfig.requireInFrame, false);
assert.equal(effectiveInteractionConfig.countdownSkipValidation, true);
assert.equal(effectiveInteractionConfig.gestureFallbackMs, 12_000);
assert.equal(effectiveInteractionConfig.manualShutterEnabled, true);
assert.equal(effectiveInteractionConfig.instructionCycleMs, 3_000);
assert.equal(effectiveInteractionConfig.immediateGestureFeedback, true);

assert.equal(interactionConfig.tracking.trackConfirmFrames, 5);
assert.equal(interactionConfig.zoneBypass.minPersonScaleRatio, 0.1);
assert.equal(interactionConfig.zones.activeGroupSettleMs, 500);
assert.equal(interactionConfig.directLeadInMs, 420);
assert.equal(interactionConfig.raiseArmConfirmScore, 0.68);
assert.equal(interactionConfig.gestureConfirmMs, 800);
assert.equal(interactionConfig.waveGesture.minAmplitude, 0.3);
assert.equal(interactionConfig.readyHoldMs, 420);
assert.equal(interactionConfig.trackingLossGraceMs, 1000);

const upperBodyOnly = person('upper-body');
delete upperBodyOnly.keypoints.leftHip;
delete upperBodyOnly.keypoints.rightHip;
assert.equal(
  subjectInFrameResult(
    upperBodyOnly,
    effectiveInteractionConfig.inFrameRequiredKeypoints,
  ).pass,
  true,
  'Demo framing must not require hips',
);
const outOfFrame = subjectInFrameResult(
  person('nose-out', { noseX: 0.01 }),
  effectiveInteractionConfig.inFrameRequiredKeypoints,
);
assert.equal(outOfFrame.pass, false);
assert.equal(outOfFrame.reason, 'nose out of frame');

const trackStore = new PersonTrackStore(
  effectiveInteractionConfig.trackConfirmFrames,
);
assert.equal(trackStore.stabilize(frame(0, [person('raw-1')]), 1000, 1000).frame.people.length, 0);
const confirmedFrame = trackStore.stabilize(
  frame(140, [person('raw-1')]),
  1000,
  1000,
).frame;
assert.equal(confirmedFrame.people.length, 1, 'Demo tracks confirm on frame two');

const zoneTracker = new ZoneTracker(
  true,
  effectiveInteractionConfig.minPersonScaleRatio,
  effectiveInteractionConfig.activeGroupStableMs,
);
const zoneSnapshot = zoneTracker.update(confirmedFrame);
assert.equal(zoneSnapshot.capturePeople.length, 1);
assert.equal(zoneSnapshot.activeStable, true);

const raisedPerson = person('raised', { raised: true, wristY: 0.371 });
const raise = evaluateRaiseArm(
  [raisedPerson],
  null,
  effectiveInteractionConfig.raiseArmScoreThreshold,
);
assert.ok(raise.matchScore >= 0.55 && raise.matchScore < 0.68);
assert.equal(raise.satisfied, true);
const stability = new GestureStabilityTracker(
  effectiveInteractionConfig.raiseArmHoldMs,
);
stability.update(true, true, 0);
assert.equal(stability.update(true, true, 499).confirmed, false);
assert.equal(stability.update(true, true, 500).confirmed, true);

const waveRule = new WaveGestureRule({
  minCrossings: effectiveInteractionConfig.waveMinCrossings,
  minAmplitude: effectiveInteractionConfig.waveMinAmplitude,
});
let wave = waveRule.update(person('wave', { raised: true, wristNx: -0.12 }), 0);
wave = waveRule.update(person('wave', { raised: true, wristNx: 0.12 }), 100);
wave = waveRule.update(person('wave', { raised: true, wristNx: -0.12 }), 200);
wave = waveRule.update(person('wave', { raised: true, wristNx: 0.12 }), 300);
assert.equal(wave.confirmed, true);

const manualFlow = new InteractionStateMachine();
assert.equal(manualFlow.dispatch('MANUAL_SHUTTER'), 'COUNTDOWN');
assert.equal(manualFlow.dispatch('COUNTDOWN_COMPLETE'), 'CAPTURE');

const fallbackFlow = new InteractionStateMachine();
fallbackFlow.dispatch('CAPTURE_ZONE_ENTERED');
fallbackFlow.dispatch('START_DIRECT');
assert.equal(fallbackFlow.getState(), 'DIRECT');
assert.equal(fallbackFlow.dispatch('AUTO_COUNTDOWN'), 'COUNTDOWN');
assert.equal(fallbackFlow.dispatch('COUNTDOWN_COMPLETE'), 'CAPTURE');

console.log('Demo mode tests passed.');
