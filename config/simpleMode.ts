export type SimpleGestureTarget = 'wave' | 'victory' | 'thumbs-up';

export const simpleMode = {
  enabled: true,

  personPresentLatchMs: 2000,

  // Off while the three gestures are being evaluated: standing in view no
  // longer fills the ring on its own, so a lock can only come from a gesture
  // or the manual shutter. Turn back on for the unattended installation.
  autoReadyEnabled: false,
  autoReadyMs: 5000,
  handRaisedBoostPerSec: 0.6,
  gestureConfirmFillsRing: true,
  iSeeYouMs: 800,
  positionGuidanceMs: 1200,
  subCopyRotateMs: 2500,

  lockedFeedbackMs: 2200,

  countdownSeconds: 3,
  photoPreviewMs: 3200,
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
  // How far below the shoulder a wrist may sit and still start MediaPipe,
  // measured in shoulder widths. The gate exists to keep inference at zero
  // while nobody is gesturing; it is not a recognition requirement, so it only
  // has to stay above a hanging arm. 0 restores the shoulder-height rule.
  wristGateShoulderWidthFactor: 0.6,
  // Chest height alone would also admit folded arms and hands at rest, so the
  // forearm must be lifted as well when the elbow is visible. MoveNet reports
  // every joint whether or not it found one, so an elbow only gets a vote once
  // it clears this confidence.
  wristGateRequireWristAboveElbow: true,
  wristGateMinElbowConfidence: 0.3,
  cropShoulderWidthFactor: 1.2,
  inputSize: 192,
  acceptedCategories: ['Thumb_Up', 'Victory'] as const,
  minConfidence: 0.6,
  stableConfirmations: 3,
  minHandDetectionConfidence: 0.3,
  minHandPresenceConfidence: 0.3,
  minTrackingConfidence: 0.3,
} as const;
