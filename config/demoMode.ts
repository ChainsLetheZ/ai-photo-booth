import type { BodyJoint } from '../perception/types';

/**
 * Exhibition-only reliability overrides. Set enabled=false to restore the
 * original interaction configuration and validation path unchanged.
 */
export const demoMode = {
  enabled: true,
  trackConfirmFrames: 2,
  minPersonScaleRatio: 0.06,
  activeGroupStableMs: 0,
  preGestureDelayMs: 0,
  inFrameRequiredKeypoints: [
    'nose',
    'leftShoulder',
    'rightShoulder',
  ] as const satisfies readonly BodyJoint[],
  requireInFrame: false,
  raiseArmScoreThreshold: 0.55,
  raiseArmHoldMs: 500,
  waveMinCrossings: 2,
  waveMinAmplitude: 0.22,
  postGestureDelayMs: 0,
  countdownAllowIdChange: true,
  countdownGracePeriodMs: 800,
  countdownSkipValidation: true,
  gestureFallbackMs: 12_000,
  manualShutterEnabled: true,
  instructionCycleMs: 3_000,
  immediateGestureFeedback: true,
} as const;
