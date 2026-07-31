import type { SecondaryDimension } from '../types';

/**
 * Prototype thresholds live in one place so the booth team can tune them on
 * the target camera, lens and floor layout without touching product logic.
 */
export const interactionConfig = {
  mediaPipe: {
    wasmPath: '/mediapipe/wasm',
    poseModelPath: '/mediapipe/models/pose_landmarker_lite.task',
    handModelPath: '/mediapipe/models/hand_landmarker.task',
    delegate: 'GPU' as const,
    maxPoses: 6,
    maxHands: 8,
    targetFps: 24,
    minimumPoseConfidence: 0.58,
    minimumHandConfidence: 0.5,
  },
  gestureConfirmMs: 400,
  readyHoldMs: 520,
  trackingLossGraceMs: 1000,
  gestureFallbackMs: 6500,
  analysisDurationMs: 1800,
  responseDurationMs: 1400,
  instructionLeadInMs: 850,
  armsOpenDistance: 0.52,
  wristBodyDistanceRatio: 0.82,
  handConvergenceDistance: 0.17,
  groupHandCentroidDistance: 0.24,
  peopleCloseDistance: 0.34,
  groupCohesionReady: 0.62,
  movementLowThreshold: 0.12,
  movementHighThreshold: 0.5,
  movementVelocityScale: 1.35,
  inFrameMargin: 0.035,
  secondaryMinimumConfidence: 0.28,
  secondaryFallback: 'Precision' as SecondaryDimension,
  movementWindowMs: 1200,
  featureHistoryMs: 2400,
  narrativeTimeoutMs: 1800,
} as const;

export type InteractionConfig = typeof interactionConfig;
