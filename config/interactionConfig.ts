import type { SecondaryDimension } from '../types';

export const perception = {
  preferredEngine: 'movenet' as const,
  allowMediaPipeFallback: true,
  minKeypointConfidence: 0.5,
  minPoseScore: 0.35,
  maxPoses: 6,
  maxActiveParticipants: 5,
  roiInputSize: 256,
  targetFps: 20,
  interactionRoi: {
    xMin: 0.08,
    xMax: 0.92,
    yMin: 0,
    yMax: 1,
  },
} as const;

export const sanity = {
  // Replay of static_near found two real-person frames at 40.8–41.9 px on a
  // 1440 px frame. 0.027 keeps those frames while still rejecting 1.1 px ghosts.
  minShoulderWidthRatio: 0.027,
  minTorsoRatio: 0.06,
  maxTorsoRatio: 0.6,
  minAspect: 0.15,
  maxAspect: 3,
  minValidKeypoints: 6,
  requireCoreKeypoints: true,
} as const;

export const tracking = {
  trackConfirmFrames: 5,
  stableTrackReassociateRadius: 0.15,
  stableTrackGracePeriodMs: 500,
  maxReassociateScaleDifference: 0.2,
} as const;

export const posture = {
  maxTorsoTiltDeg: 35,
  minTorsoRatioOfMedian: 0.75,
  postureInvalidGraceMs: 1500,
} as const;

export const baselineConfig = {
  followRate: 0.005,
  minStableFramesBeforeInit: 5,
  maxDriftForUpdate: 0.03,
  maxVelocityForUpdate: 0.02,
  freezeOnZone: 'Z2' as const,
  unfreezeStableMs: 1000,
} as const;

// Calibrated for the current camera position. Recalibrate at the exhibition
// venue whenever camera height, tilt, lens or floor marks change.
export const zoneThresholds = {
  enterZ2Growth: 1.045,
  exitZ2Growth: 1.020,
} as const;

export const dwellConfig = {
  enterSeconds: 0.7,
  exitSeconds: 0.3,
  decayInDeadband: 0,
} as const;

export const zoneProxy = 'bodyScale' as const satisfies 'bodyScale' | 'footY';

export const bodyScaleProbe = {
  enabled: true,
  minKeypointConfidence: perception.minKeypointConfidence,
  shoulderWidthFactor: 0.8,
  medianWindowSize: 3,
  oneEuro: { minCutoff: 0.8, beta: 0.02, dCutoff: 1.0 },
  baselineFollowRate: baselineConfig.followRate,
  enterZ2Growth: zoneThresholds.enterZ2Growth,
  exitZ2Growth: zoneThresholds.exitZ2Growth,
  enterDwellSeconds: dwellConfig.enterSeconds,
  exitDwellSeconds: dwellConfig.exitSeconds,
} as const;

/**
 * Prototype thresholds live in one place so the booth team can tune them on
 * the target camera, lens and floor layout without touching product logic.
 */
export const interactionConfig = {
  bodyScaleProbe,
  perception,
  sanity,
  tracking,
  posture,
  baseline: baselineConfig,
  zoneThresholds,
  dwell: dwellConfig,
  zoneProxy,
  moveNet: {
    modelPath: '/models/movenet/model.json',
    scoreThreshold: 0.24,
    forceF16Textures: true,
    scriptUrls: [
      '/vendor/movenet/tf-core.min.js',
      '/vendor/movenet/tf-converter.min.js',
      '/vendor/movenet/tf-backend-webgl.min.js',
      '/vendor/movenet/pose-detection.min.js',
    ],
  },
  mediaPipe: {
    wasmPath: '/mediapipe/wasm',
    poseModelPath: '/mediapipe/models/pose_landmarker_lite.task',
    handModelPath: '/mediapipe/models/hand_landmarker.task',
    delegate: 'GPU' as const,
    maxHands: 8,
    minimumPoseConfidence: 0.58,
    minimumHandConfidence: 0.5,
  },
  zones: {
    preset: 'DEMO_HALF_METER_STEP' as const,
    approximateForwardStepMeters: 0.5,
    engagedEnterY: 0.44,
    engagedExitY: 0.39,
    captureEnterY: 0.7,
    captureExitY: 0.65,
    horizontalMargin: 0.06,
    stableDwellMs: 550,
    trackRetentionMs: 1100,
    activeGroupSettleMs: 500,
  },
  feedback: {
    firstRecognitionMs: 720,
    confirmationSweepMs: 480,
    confirmationFadeMs: 420,
  },
  gestureConfirmMs: 800,
  gestureReleaseMs: 180,
  raiseArmStartScore: 0.28,
  raiseArmConfirmScore: 0.68,
  readyHoldMs: 420,
  directLeadInMs: 420,
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
  defaultPrimary: 'Intelligence' as const,
} as const;

export type InteractionConfig = typeof interactionConfig;
