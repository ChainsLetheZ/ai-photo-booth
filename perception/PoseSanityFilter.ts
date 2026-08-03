import { interactionConfig } from '../config/interactionConfig';
import type {
  Landmark,
  NormalizedBounds,
  PersonObservation,
} from './types';

export interface SanityConfig {
  minShoulderWidthRatio: number;
  minTorsoRatio: number;
  maxTorsoRatio: number;
  minAspect: number;
  maxAspect: number;
  minValidKeypoints: number;
  requireCoreKeypoints: boolean;
}

export type SanityRejectReason =
  | 'too_small'
  | 'too_large'
  | 'bad_aspect'
  | 'few_keypoints'
  | 'missing_core'
  | 'out_of_roi';

export interface SanityResult {
  pass: boolean;
  rejectReason?: SanityRejectReason;
}

const CORE_NAMES = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
] as const;

export function keypointConfidence(
  landmark: Landmark | undefined,
): number | null {
  if (!landmark) return null;
  const scores = [landmark.visibility, landmark.presence].filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  return scores.length ? Math.min(...scores) : null;
}

function distance(
  first: Landmark,
  second: Landmark,
  width: number,
  height: number,
) {
  return Math.hypot(
    (first.x - second.x) * width,
    (first.y - second.y) * height,
  );
}

function midpoint(first: Landmark, second: Landmark): Landmark {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: (first.z + second.z) / 2,
  };
}

function boundsCenterInRoi(
  person: PersonObservation,
  roi: NormalizedBounds,
) {
  const centerX = (person.bounds.xMin + person.bounds.xMax) / 2;
  const centerY = (person.bounds.yMin + person.bounds.yMax) / 2;
  return (
    centerX >= roi.xMin &&
    centerX <= roi.xMax &&
    centerY >= roi.yMin &&
    centerY <= roi.yMax
  );
}

export function poseSanityFilter(
  person: PersonObservation,
  frameWidth: number,
  frameHeight: number,
  config: SanityConfig = interactionConfig.sanity,
  minKeypointConfidence = interactionConfig.perception.minKeypointConfidence,
  roi: NormalizedBounds = {
    ...interactionConfig.perception.interactionRoi,
    width:
      interactionConfig.perception.interactionRoi.xMax -
      interactionConfig.perception.interactionRoi.xMin,
    height:
      interactionConfig.perception.interactionRoi.yMax -
      interactionConfig.perception.interactionRoi.yMin,
  },
): SanityResult {
  const width = Math.max(1, frameWidth);
  const height = Math.max(1, frameHeight);
  const core = CORE_NAMES.map((name) => person.keypoints[name]);
  if (
    config.requireCoreKeypoints &&
    core.some(
      (point) =>
        !point ||
        (keypointConfidence(point) ?? Number.NEGATIVE_INFINITY) <
          minKeypointConfidence,
    )
  ) {
    return { pass: false, rejectReason: 'missing_core' };
  }

  const validKeypoints = Object.values(person.keypoints).filter(
    (point) =>
      point &&
      (keypointConfidence(point) ?? Number.NEGATIVE_INFINITY) >=
        minKeypointConfidence,
  ).length;
  if (validKeypoints < config.minValidKeypoints) {
    return { pass: false, rejectReason: 'few_keypoints' };
  }
  if (!boundsCenterInRoi(person, roi)) {
    return { pass: false, rejectReason: 'out_of_roi' };
  }

  const [leftShoulder, rightShoulder, leftHip, rightHip] = core as [
    Landmark,
    Landmark,
    Landmark,
    Landmark,
  ];
  const shoulderWidth = distance(leftShoulder, rightShoulder, width, height);
  const torso = distance(
    midpoint(leftShoulder, rightShoulder),
    midpoint(leftHip, rightHip),
    width,
    height,
  );
  if (
    shoulderWidth / width < config.minShoulderWidthRatio ||
    torso / height < config.minTorsoRatio
  ) {
    return { pass: false, rejectReason: 'too_small' };
  }
  if (torso / height > config.maxTorsoRatio) {
    return { pass: false, rejectReason: 'too_large' };
  }
  const aspect = shoulderWidth / Math.max(torso, Number.EPSILON);
  if (aspect < config.minAspect || aspect > config.maxAspect) {
    return { pass: false, rejectReason: 'bad_aspect' };
  }
  return { pass: true };
}
