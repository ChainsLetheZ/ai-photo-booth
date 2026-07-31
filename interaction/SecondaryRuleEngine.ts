import { interactionConfig } from '../config/interactionConfig';
import type { BehaviorFeatures } from '../behavior/types';
import type { SecondaryDimension } from '../types';

export interface SecondaryScores {
  Collaboration: number;
  Precision: number;
  Momentum: number;
  Exploration: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scoreSecondaryDimensions(
  features: BehaviorFeatures,
): SecondaryScores {
  const collaboration =
    features.personCount > 1
      ? features.groupCohesion * 0.5 +
        (features.handsConverged || features.handsTowardCenter ? 0.3 : 0) +
        (features.movementSynchrony ?? 0.5) * 0.2
      : 0.08;
  const precisionBase =
    features.stability * 0.62 +
    (features.allSubjectsInFrame ? 0.24 : 0) +
    (features.detectionStable ? 0.14 : 0);
  const precision =
    features.personCount > 1 &&
    (features.handsConverged || features.handsTowardCenter)
      ? precisionBase * 0.82
      : precisionBase;
  const momentum = features.movementIntensity;
  const exploration =
    features.spatialExploration > 0.2
      ? features.spatialExploration * 0.72 +
        Math.min(features.movementIntensity, 0.45) * 0.28
      : 0;

  return {
    Collaboration: clamp01(collaboration),
    Precision: clamp01(precision),
    Momentum: clamp01(momentum),
    Exploration: clamp01(exploration),
  };
}

export function selectSecondaryDimension(scores: SecondaryScores) {
  const ranked = (Object.entries(scores) as Array<
    [SecondaryDimension, number]
  >).sort((first, second) => second[1] - first[1]);
  const [dimension, confidence] = ranked[0];
  return {
    dimension:
      confidence >= interactionConfig.secondaryMinimumConfidence
        ? dimension
        : interactionConfig.secondaryFallback,
    confidence,
    scores,
  };
}
