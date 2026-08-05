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
  /** The measured numbers behind the rejection. Diagnostics only. */
  rejectDetail?: string;
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
  if (config.requireCoreKeypoints) {
    let weakestName = '';
    let weakestConfidence = Number.POSITIVE_INFINITY;
    CORE_NAMES.forEach((name, index) => {
      const point = core[index];
      const confidence = point
        ? keypointConfidence(point) ?? Number.NEGATIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
      if (confidence < weakestConfidence) {
        weakestConfidence = confidence;
        weakestName = name;
      }
    });
    if (weakestConfidence < minKeypointConfidence) {
      return {
        pass: false,
        rejectReason: 'missing_core',
        rejectDetail: Number.isFinite(weakestConfidence)
          ? `${weakestName} ${weakestConfidence.toFixed(2)} < ${minKeypointConfidence.toFixed(2)}`
          : `${weakestName} absent`,
      };
    }
  }

  const validKeypoints = Object.values(person.keypoints).filter(
    (point) =>
      point &&
      (keypointConfidence(point) ?? Number.NEGATIVE_INFINITY) >=
        minKeypointConfidence,
  ).length;
  if (validKeypoints < config.minValidKeypoints) {
    return {
      pass: false,
      rejectReason: 'few_keypoints',
      rejectDetail: `${validKeypoints}/${config.minValidKeypoints} keypoints ≥ ${minKeypointConfidence.toFixed(2)}`,
    };
  }
  if (!boundsCenterInRoi(person, roi)) {
    return {
      pass: false,
      rejectReason: 'out_of_roi',
      rejectDetail: `center ${((person.bounds.xMin + person.bounds.xMax) / 2).toFixed(2)},${((person.bounds.yMin + person.bounds.yMax) / 2).toFixed(2)} outside ${roi.xMin}–${roi.xMax} x ${roi.yMin}–${roi.yMax}`,
    };
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
  const sizeDetail =
    `shoulder ${shoulderWidth.toFixed(0)}px (min ${(config.minShoulderWidthRatio * width).toFixed(0)})` +
    ` · torso ${torso.toFixed(0)}px (min ${(config.minTorsoRatio * height).toFixed(0)})`;
  if (
    shoulderWidth / width < config.minShoulderWidthRatio ||
    torso / height < config.minTorsoRatio
  ) {
    return { pass: false, rejectReason: 'too_small', rejectDetail: sizeDetail };
  }
  if (torso / height > config.maxTorsoRatio) {
    return {
      pass: false,
      rejectReason: 'too_large',
      rejectDetail: `torso ${torso.toFixed(0)}px (max ${(config.maxTorsoRatio * height).toFixed(0)})`,
    };
  }
  const aspect = shoulderWidth / Math.max(torso, Number.EPSILON);
  if (aspect < config.minAspect || aspect > config.maxAspect) {
    return {
      pass: false,
      rejectReason: 'bad_aspect',
      rejectDetail: `aspect ${aspect.toFixed(2)} outside ${config.minAspect}–${config.maxAspect} · ${sizeDetail}`,
    };
  }
  return { pass: true };
}
