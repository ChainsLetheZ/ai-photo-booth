import { interactionConfig } from '../config/interactionConfig';
import type { BehaviorFeatures } from '../behavior/types';
import type { GroupMode } from '../types';

export type RequiredPrimitive =
  | 'ARMS_OPEN'
  | 'PEOPLE_CLOSE + HANDS_CONVERGED'
  | 'HIGH_COHESION + HANDS_TOWARD_CENTER';

export interface GestureRuleResult {
  requiredPrimitive: RequiredPrimitive;
  satisfied: boolean;
  matchScore: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function evaluateGesture(
  mode: GroupMode,
  features: BehaviorFeatures,
): GestureRuleResult {
  if (mode === 'Single') {
    return {
      requiredPrimitive: 'ARMS_OPEN',
      satisfied:
        features.armsOpen &&
        features.allSubjectsInFrame &&
        features.detectionStable,
      matchScore: features.armsOpen ? 1 : 0,
    };
  }

  if (mode === 'Pair') {
    const matchScore =
      (features.peopleClose ? 0.45 : 0) +
      (features.handsConverged ? 0.45 : 0) +
      features.groupCohesion * 0.1;
    return {
      requiredPrimitive: 'PEOPLE_CLOSE + HANDS_CONVERGED',
      satisfied:
        features.personCount >= 2 &&
        features.peopleClose &&
        features.handsConverged &&
        features.allSubjectsInFrame &&
        features.detectionStable,
      matchScore: clamp01(matchScore),
    };
  }

  const matchScore =
    features.groupCohesion * 0.55 +
    (features.handsTowardCenter ? 0.35 : 0) +
    (features.allSubjectsInFrame ? 0.1 : 0);
  return {
    requiredPrimitive: 'HIGH_COHESION + HANDS_TOWARD_CENTER',
    satisfied:
      features.personCount >= 3 &&
      features.groupCohesion >= interactionConfig.groupCohesionReady &&
      features.handsTowardCenter &&
      features.allSubjectsInFrame &&
      features.detectionStable,
    matchScore: clamp01(matchScore),
  };
}
