import type { SecondaryDimension } from '../types';

/**
 * Prototype thresholds live in one place so the booth team can tune them on
 * the target camera, lens and floor layout without touching product logic.
 */
export const interactionConfig = {
  perception: {
    preferredEngine: 'movenet' as const,
    allowMediaPipeFallback: true,
    targetFps: 24,
    maxDetectedPoses: 6,
    maxActiveParticipants: 5,
    interactionRoi: {
      xMin: 0.08,
      xMax: 0.92,
      yMin: 0,
      yMax: 1,
    },
  },
  moveNet: {
    modelPath: '/models/movenet/model.json',
    scoreThreshold: 0.24,
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
    maxPoses: 6,
    maxHands: 8,
    targetFps: 24,
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
