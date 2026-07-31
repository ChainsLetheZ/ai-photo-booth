import { interactionConfig } from '../config/interactionConfig';

export interface StabilityResult {
  confirmed: boolean;
  progress: number;
  trackingLost: boolean;
}

export class GestureStabilityTracker {
  private satisfiedSince: number | null = null;
  private falseSince: number | null = null;
  private lastTrackingAt = 0;

  update(
    satisfied: boolean,
    trackingAvailable: boolean,
    timestamp: number,
  ): StabilityResult {
    if (trackingAvailable) this.lastTrackingAt = timestamp;
    const trackingLost =
      this.lastTrackingAt > 0 &&
      timestamp - this.lastTrackingAt > interactionConfig.trackingLossGraceMs;

    if (satisfied && trackingAvailable) {
      this.falseSince = null;
      if (this.satisfiedSince === null) this.satisfiedSince = timestamp;
    } else if (!trackingAvailable && !trackingLost) {
      // Brief tracking gaps preserve the current hold progress.
    } else {
      if (this.falseSince === null) this.falseSince = timestamp;
      if (
        timestamp - this.falseSince >
        interactionConfig.gestureReleaseMs
      ) {
        this.satisfiedSince = null;
      }
    }

    const heldFor =
      this.satisfiedSince === null ? 0 : timestamp - this.satisfiedSince;
    return {
      confirmed: heldFor >= interactionConfig.gestureConfirmMs,
      progress: Math.min(1, heldFor / interactionConfig.gestureConfirmMs),
      trackingLost,
    };
  }

  reset() {
    this.satisfiedSince = null;
    this.falseSince = null;
    this.lastTrackingAt = 0;
  }
}
