import assert from 'node:assert/strict';
import { handGesture } from '../config/simpleMode';
import {
  computeHandCrop,
  GestureConfirmationTracker,
  handRecognitionDue,
  raisedWristCandidates,
} from '../perception/MediaPipeGestureService';
import type {
  BodyKeypoints,
  PersonObservation,
} from '../perception/types';

function person(
  wristY: number,
  wristX = 0.42,
  elbowY = 0.58,
  id = 'stable-1',
): PersonObservation {
  const keypoints: BodyKeypoints = {
    leftShoulder: { x: 0.4, y: 0.4, z: 0, visibility: 0.95 },
    rightShoulder: { x: 0.6, y: 0.4, z: 0, visibility: 0.95 },
    leftElbow: { x: 0.38, y: elbowY, z: 0, visibility: 0.95 },
    rightElbow: { x: 0.62, y: 0.58, z: 0, visibility: 0.95 },
    leftWrist: { x: wristX, y: wristY, z: 0, visibility: 0.95 },
    rightWrist: { x: 0.62, y: 0.62, z: 0, visibility: 0.95 },
  };
  return {
    id,
    source: 'movenet',
    poseLandmarks: Object.values(keypoints),
    keypoints,
    bounds: {
      xMin: 0.3,
      yMin: 0.2,
      xMax: 0.7,
      yMax: 0.8,
      width: 0.4,
      height: 0.6,
    },
    footPoint: { x: 0.5, y: 0.8 },
    centerX: 0.5,
    centerY: 0.5,
    visibleConfidence: 0.95,
  };
}

assert.equal(handGesture.modelPath, '/mediapipe/models/gesture_recognizer.task');
assert.equal(handGesture.modelPath.includes('storage.googleapis.com'), false);
assert.equal(handGesture.recognizeHz, 4);
assert.equal(handGesture.inputSize, 192);

// Shoulders at y 0.4 and 256px apart over a 720px frame allow a wrist down to
// y ≈ 0.613 before the gate closes.
assert.equal(
  raisedWristCandidates([person(0.62)], 1280, 720).length,
  0,
  'An arm hanging at rest must not start MediaPipe',
);
assert.equal(
  raisedWristCandidates([person(0.55, 0.42, 0.5)], 1280, 720).length,
  0,
  'A wrist below its own elbow must not start MediaPipe',
);
const unsureElbow = person(0.55, 0.42, 0.5);
unsureElbow.keypoints.leftElbow!.visibility = 0.1;
assert.equal(
  raisedWristCandidates([unsureElbow], 1280, 720).length,
  1,
  'An elbow MoveNet is unsure about must not veto a chest-height gesture',
);

const chestHigh = raisedWristCandidates([person(0.55)], 1280, 720);
assert.equal(
  chestHigh.length,
  1,
  'A chest-height gesture with a lifted forearm must start MediaPipe',
);
assert.equal(chestHigh[0].side, 'left');

const raised = raisedWristCandidates([person(0.39)], 1280, 720);
assert.equal(raised.length, 1);
assert.equal(raised[0].side, 'left');

const crop = computeHandCrop(raised[0], 1280, 720);
assert.equal(crop.sourceSize, Math.round(256 * 1.2));
assert.equal(crop.inputSize, 192);
assert.ok(crop.sourceX >= 0 && crop.sourceY >= 0);
assert.ok(crop.sourceX + crop.sourceSize <= 1280);
assert.ok(crop.sourceY + crop.sourceSize <= 720);

const edge = raisedWristCandidates([person(0.1, 0.01)], 1280, 720)[0];
const edgeCrop = computeHandCrop(edge, 1280, 720);
assert.equal(edgeCrop.sourceX, 0, 'Crop must clamp at the source boundary');

assert.equal(handRecognitionDue(null, 0), true);
assert.equal(handRecognitionDue(0, 249), false);
assert.equal(handRecognitionDue(0, 250), true);

const tracker = new GestureConfirmationTracker();
assert.deepEqual(tracker.update('Victory', 0.87, 'stable-1:left'), {
  category: 'Victory',
  count: 1,
  confirmed: false,
});
assert.equal(
  tracker.update('Victory', 0.88, 'stable-1:left').confirmed,
  false,
);
const confirmed = tracker.update('Victory', 0.89, 'stable-1:left');
assert.equal(confirmed.count, 3);
assert.equal(confirmed.confirmed, true);

assert.equal(
  tracker.update('Thumb_Up', 0.91, 'stable-1:left').count,
  1,
  'Changing classification must restart the stability counter',
);
assert.equal(
  tracker.update('Thumb_Up', 0.59, 'stable-1:left').count,
  0,
  'A result below 0.6 must reset confirmation',
);
assert.equal(
  tracker.update('Thumb_Up', 0.9, 'stable-2:right').count,
  1,
  'A different hand must not inherit another hand’s confirmations',
);

// Recognition rotates between every raised hand, so counting has to survive
// the rotation; one person in the group gesturing is enough.
const rotating = new GestureConfirmationTracker();
const rotation = ['stable-1:left', 'stable-2:right'];
let confirmedAtRun = -1;
for (let run = 0; run < 6; run += 1) {
  const result = rotating.update('Victory', 0.9, rotation[run % 2]);
  if (result.confirmed && confirmedAtRun < 0) confirmedAtRun = run;
}
assert.equal(
  confirmedAtRun,
  4,
  'Two raised hands must still let one of them reach confirmation',
);

rotating.retain(['stable-1:left']);
assert.equal(
  rotating.update('Victory', 0.9, 'stable-2:right').count,
  1,
  'A hand that left the frame must not keep its confirmations',
);

assert.equal(
  raisedWristCandidates(
    [person(0.39), person(0.39, 0.42, 0.58, 'stable-2')],
    1280,
    720,
  ).length,
  2,
  'Both raised hands stay candidates so either person can confirm',
);

console.log('Hand gesture accelerator tests passed.');

