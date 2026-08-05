import { interactionConfig } from '../config/interactionConfig';
import type {
  BodyKeypoints,
  Landmark,
  PersonObservation,
} from '../perception/types';
import type { WaveState } from './WaveGestureRule';

export type RaisedArmSide = 'left' | 'right';

export interface GestureRuleResult {
  requiredPrimitive: 'RAISE_ONE_ARM' | 'WAVE';
  satisfied: boolean;
  matchScore: number;
  initiatorId: string | null;
  arm: RaisedArmSide | null;
  wave?: WaveState;
}
function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function visible(point?: Landmark) {
  return Boolean(
    point &&
      (point.visibility ?? point.presence ?? 1) >=
        interactionConfig.moveNet.scoreThreshold,
  );
}

function torsoLength(keypoints: BodyKeypoints) {
  const { leftShoulder, rightShoulder, leftHip, rightHip } = keypoints;
  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip
  ) {
    return 0.18;
  }
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  return Math.max(0.1, Math.abs(hipY - shoulderY));
}

function armScore(
  keypoints: BodyKeypoints,
  side: RaisedArmSide,
) {
  const shoulder =
    side === 'left' ? keypoints.leftShoulder : keypoints.rightShoulder;
  const elbow =
    side === 'left' ? keypoints.leftElbow : keypoints.rightElbow;
  const wrist =
    side === 'left' ? keypoints.leftWrist : keypoints.rightWrist;
  if (!visible(shoulder) || !visible(elbow) || !visible(wrist)) return 0;

  const normalizedRise = (shoulder!.y - wrist!.y) / torsoLength(keypoints);
  const elbowParticipation = elbow!.y < shoulder!.y + torsoLength(keypoints) * 0.35;
  const score = clamp01((normalizedRise + 0.08) / 0.62);
  return elbowParticipation ? score : score * 0.65;
}

function personGesture(person: PersonObservation) {
  const left = armScore(person.keypoints, 'left');
  const right = armScore(person.keypoints, 'right');
  return left >= right
    ? { person, arm: 'left' as const, score: left }
    : { person, arm: 'right' as const, score: right };
}

export function evaluateRaiseArm(
  people: PersonObservation[],
  lockedInitiatorId: string | null = null,
  confirmScore: number = interactionConfig.raiseArmConfirmScore,
): GestureRuleResult {
  const eligible = lockedInitiatorId
    ? people.filter((person) => person.id === lockedInitiatorId)
    : people;
  const best = eligible
    .map(personGesture)
    .sort((first, second) => second.score - first.score)[0];
  const matchScore = best?.score ?? 0;
  const initiatorId =
    best && matchScore >= interactionConfig.raiseArmStartScore
      ? best.person.id
      : null;
  return {
    requiredPrimitive: 'RAISE_ONE_ARM',
    satisfied:
      Boolean(initiatorId) &&
      matchScore >= confirmScore,
    matchScore,
    initiatorId,
    arm: initiatorId ? best.arm : null,
  };
}
