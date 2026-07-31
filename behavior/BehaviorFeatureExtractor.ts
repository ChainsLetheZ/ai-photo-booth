import { interactionConfig } from '../config/interactionConfig';
import type { PerceptionFrame, PersonObservation } from '../perception/types';
import { analyzeGroup } from './GroupAnalyzer';
import { MovementTracker } from './MovementTracker';
import type { BehaviorFeatures } from './types';

const REQUIRED_IN_FRAME_LANDMARKS = [0, 11, 12, 15, 16, 23, 24];

function visible(landmark?: {
  visibility?: number;
  presence?: number;
}) {
  return (
    (landmark?.visibility ?? landmark?.presence ?? 1) >=
    interactionConfig.mediaPipe.minimumPoseConfidence
  );
}

function isArmsOpen(person: PersonObservation) {
  const landmarks = person.poseLandmarks;
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftElbow = landmarks[13];
  const rightElbow = landmarks[14];
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  if (
    ![
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftWrist,
      rightWrist,
    ].every(Boolean) ||
    !visible(leftWrist) ||
    !visible(rightWrist)
  ) {
    return false;
  }

  const shoulderWidth = Math.max(
    0.08,
    Math.hypot(
      leftShoulder.x - rightShoulder.x,
      leftShoulder.y - rightShoulder.y,
    ),
  );
  const wristDistance = Math.abs(leftWrist.x - rightWrist.x);
  const bodyCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const wristsAwayFromBody =
    Math.abs(leftWrist.x - bodyCenterX) >
      shoulderWidth * interactionConfig.wristBodyDistanceRatio &&
    Math.abs(rightWrist.x - bodyCenterX) >
      shoulderWidth * interactionConfig.wristBodyDistanceRatio;
  const elbowsExtended =
    Math.abs(leftElbow.x - bodyCenterX) > shoulderWidth * 0.48 &&
    Math.abs(rightElbow.x - bodyCenterX) > shoulderWidth * 0.48;

  return (
    wristDistance >= interactionConfig.armsOpenDistance &&
    wristsAwayFromBody &&
    elbowsExtended
  );
}

function subjectInFrame(person: PersonObservation) {
  const margin = interactionConfig.inFrameMargin;
  return REQUIRED_IN_FRAME_LANDMARKS.every((index) => {
    const landmark = person.poseLandmarks[index];
    return (
      landmark &&
      visible(landmark) &&
      landmark.x >= margin &&
      landmark.x <= 1 - margin &&
      landmark.y >= margin &&
      landmark.y <= 1 - margin
    );
  });
}

export class BehaviorFeatureExtractor {
  private readonly movementTracker = new MovementTracker();
  private countHistory: Array<{ timestamp: number; count: number }> = [];

  extract(frame: PerceptionFrame): BehaviorFeatures {
    const personCount = frame.people.length;
    const group = analyzeGroup(frame.people, frame.hands);
    const movement = this.movementTracker.update(frame);
    this.countHistory.push({ timestamp: frame.timestamp, count: personCount });
    this.countHistory = this.countHistory.filter(
      (sample) =>
        frame.timestamp - sample.timestamp <= interactionConfig.gestureConfirmMs,
    );
    const detectionStable =
      personCount > 0 &&
      this.countHistory.length >= 2 &&
      this.countHistory.every((sample) => sample.count === personCount);

    return {
      personCount,
      armsOpen: frame.people.some(isArmsOpen),
      handsConverged: group.handsConverged,
      handsTowardCenter: group.handsTowardCenter,
      peopleClose: group.peopleClose,
      groupCohesion: group.groupCohesion,
      movementIntensity: movement.movementIntensity,
      movementSynchrony: movement.movementSynchrony,
      spatialExploration: movement.spatialExploration,
      stability: movement.stability,
      poseReady: false,
      allSubjectsInFrame:
        personCount > 0 && frame.people.every(subjectInFrame),
      detectionStable,
    };
  }

  reset() {
    this.movementTracker.reset();
    this.countHistory = [];
  }
}
