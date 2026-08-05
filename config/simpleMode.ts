export const simpleMode = {
  enabled: true,

  personPresentLatchMs: 2000,

  autoReadyMs: 5000,
  handRaisedBoostPerSec: 0.6,
  gestureConfirmFillsRing: true,
  iSeeYouMs: 800,
  subCopyRotateMs: 2500,

  lockedFeedbackMs: 600,

  countdownSeconds: 3,
  resultHoldMs: 5000,
  cooldownMs: 3000,

  allowManualShutter: true,
  haloCollapseMs: 500,
} as const;

export const simpleModeGesture = {
  raiseArmScoreThreshold: 0.45,
  raiseArmHoldMs: 350,
  waveMinCrossings: 1,
  waveMinAmplitude: 0.15,
  wristAboveShoulderRatio: 0.05,
} as const;

export const handGesture = {
  enabled: true,
  wasmPath: '/mediapipe/wasm',
  modelPath: '/mediapipe/models/gesture_recognizer.task',
  recognizeHz: 4,
  cropShoulderWidthFactor: 1.2,
  inputSize: 192,
  acceptedCategories: ['Thumb_Up', 'Victory'] as const,
  minConfidence: 0.6,
  stableConfirmations: 3,
  minHandDetectionConfidence: 0.3,
  minHandPresenceConfidence: 0.3,
  minTrackingConfidence: 0.3,
} as const;
