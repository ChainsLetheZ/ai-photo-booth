import {
  baselineConfig,
  dwellConfig,
  posture,
  zoneThresholds,
} from '../config/interactionConfig';

export type BodyScaleDecisionZone = 'Z1' | 'Z2';

export interface BodyScaleDecisionInput {
  timestampMs: number;
  filtScale: number | null;
  postureValid: boolean;
}

export interface BodyScaleDecisionSnapshot {
  zone: BodyScaleDecisionZone;
  baseline: number | null;
  g: number | null;
  gVelocity: number | null;
  baselineFrozen: boolean;
  credit: number;
  baselineInitCount: number;
  postureInvalidForMs: number;
}

export interface BodyScaleDecisionOptions {
  followRate: number;
  minStableFramesBeforeInit: number;
  maxDriftForUpdate: number;
  maxVelocityForUpdate: number;
  unfreezeStableMs: number;
  enterZ2Growth: number;
  exitZ2Growth: number;
  enterSeconds: number;
  exitSeconds: number;
  decayInDeadband: number;
  postureInvalidGraceMs: number;
}

export const defaultBodyScaleDecisionOptions: BodyScaleDecisionOptions = {
  followRate: baselineConfig.followRate,
  minStableFramesBeforeInit: baselineConfig.minStableFramesBeforeInit,
  maxDriftForUpdate: baselineConfig.maxDriftForUpdate,
  maxVelocityForUpdate: baselineConfig.maxVelocityForUpdate,
  unfreezeStableMs: baselineConfig.unfreezeStableMs,
  enterZ2Growth: zoneThresholds.enterZ2Growth,
  exitZ2Growth: zoneThresholds.exitZ2Growth,
  enterSeconds: dwellConfig.enterSeconds,
  exitSeconds: dwellConfig.exitSeconds,
  decayInDeadband: dwellConfig.decayInDeadband,
  postureInvalidGraceMs: posture.postureInvalidGraceMs,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Per-track Z1/Z2 decision state. This is deliberately independent from the
 * interaction state machine: it consumes only the filtered torso scale and
 * posture validity, and exposes a stable zone for ZoneTracker to aggregate.
 */
export class BodyScaleZoneDecision {
  private readonly options: BodyScaleDecisionOptions;
  private readonly baselineInitSamples: number[] = [];
  private zone: BodyScaleDecisionZone = 'Z1';
  private baseline: number | null = null;
  private g: number | null = null;
  private gVelocity: number | null = null;
  private baselineFrozen = false;
  private credit = 0;
  private lastDecisionTimestamp?: number;
  private lastG?: number;
  private lastGTimestamp?: number;
  private unfreezeStableSince: number | null = null;
  private postureInvalidSince: number | null = null;

  constructor(options: Partial<BodyScaleDecisionOptions> = {}) {
    this.options = { ...defaultBodyScaleDecisionOptions, ...options };
  }

  update(input: BodyScaleDecisionInput): BodyScaleDecisionSnapshot {
    const { timestampMs, filtScale, postureValid } = input;
    const dt =
      this.lastDecisionTimestamp === undefined
        ? 0
        : Math.max(0, (timestampMs - this.lastDecisionTimestamp) / 1000);
    this.lastDecisionTimestamp = timestampMs;

    if (!postureValid || filtScale === null || filtScale <= 0) {
      if (!postureValid && this.postureInvalidSince === null) {
        this.postureInvalidSince = timestampMs;
      }
      this.g =
        filtScale !== null && filtScale > 0 && this.baseline !== null
          ? filtScale / this.baseline
          : null;
      return this.snapshot(timestampMs);
    }
    this.postureInvalidSince = null;

    if (this.baseline === null) {
      this.baselineInitSamples.push(filtScale);
      if (
        this.baselineInitSamples.length <
        this.options.minStableFramesBeforeInit
      ) {
        this.g = null;
        return this.snapshot(timestampMs);
      }
      this.baseline = median(this.baselineInitSamples);
      this.g = filtScale / this.baseline;
      this.lastG = this.g;
      this.lastGTimestamp = timestampMs;
      return this.snapshot(timestampMs);
    }

    let nextG = filtScale / this.baseline;
    const velocityDt =
      this.lastGTimestamp === undefined
        ? 0
        : Math.max((timestampMs - this.lastGTimestamp) / 1000, 1e-3);
    this.gVelocity =
      this.lastG === undefined || velocityDt === 0
        ? 0
        : (nextG - this.lastG) / velocityDt;
    const baselineStable =
      Math.abs(nextG - 1) < this.options.maxDriftForUpdate &&
      Math.abs(this.gVelocity) < this.options.maxVelocityForUpdate;

    if (this.zone === 'Z2') {
      this.baselineFrozen = true;
      this.unfreezeStableSince = null;
    } else if (this.baselineFrozen) {
      if (baselineStable) {
        if (this.unfreezeStableSince === null) {
          this.unfreezeStableSince = timestampMs;
        } else if (
          timestampMs - this.unfreezeStableSince >=
          this.options.unfreezeStableMs
        ) {
          this.baselineFrozen = false;
          this.unfreezeStableSince = null;
        }
      } else {
        this.unfreezeStableSince = null;
      }
    }

    if (!this.baselineFrozen && baselineStable) {
      this.baseline +=
        (filtScale - this.baseline) * this.options.followRate;
      nextG = filtScale / this.baseline;
    }
    this.g = nextG;
    this.lastG = nextG;
    this.lastGTimestamp = timestampMs;

    let vote = 0;
    if (nextG >= this.options.enterZ2Growth) vote = 1;
    else if (nextG <= this.options.exitZ2Growth) vote = -1;

    if (vote !== 0 && dt > 0) {
      const seconds = vote > 0
        ? this.options.enterSeconds
        : this.options.exitSeconds;
      this.credit += (vote * dt) / Math.max(seconds, 1e-3);
    } else if (vote === 0 && this.options.decayInDeadband > 0 && dt > 0) {
      const decay = this.options.decayInDeadband * dt;
      this.credit =
        Math.abs(this.credit) <= decay
          ? 0
          : this.credit - Math.sign(this.credit) * decay;
    }

    // Z2 uses only the negative half of the accumulator. Strong stay evidence
    // can erase an in-progress exit, but cannot pre-charge extra exit latency.
    this.credit =
      this.zone === 'Z2'
        ? clamp(this.credit, -1, 0)
        : clamp(this.credit, -1, 1);

    if (this.zone !== 'Z2' && this.credit >= 1 - 1e-9) {
      this.zone = 'Z2';
      this.baselineFrozen = true;
      this.unfreezeStableSince = null;
      this.credit = 0;
    } else if (this.zone === 'Z2' && this.credit <= -1 + 1e-9) {
      this.zone = 'Z1';
      this.baselineFrozen = true;
      this.unfreezeStableSince = null;
      this.credit = 0;
    }

    return this.snapshot(timestampMs);
  }

  getSnapshot(timestampMs = this.lastDecisionTimestamp ?? 0) {
    return this.snapshot(timestampMs);
  }

  reset() {
    this.baselineInitSamples.length = 0;
    this.zone = 'Z1';
    this.baseline = null;
    this.g = null;
    this.gVelocity = null;
    this.baselineFrozen = false;
    this.credit = 0;
    this.lastDecisionTimestamp = undefined;
    this.lastG = undefined;
    this.lastGTimestamp = undefined;
    this.unfreezeStableSince = null;
    this.postureInvalidSince = null;
  }

  private snapshot(timestampMs: number): BodyScaleDecisionSnapshot {
    return {
      zone: this.zone,
      baseline: this.baseline,
      g: this.g,
      gVelocity: this.gVelocity,
      baselineFrozen: this.baselineFrozen,
      credit: this.credit,
      baselineInitCount: this.baselineInitSamples.length,
      postureInvalidForMs:
        this.postureInvalidSince === null
          ? 0
          : Math.max(0, timestampMs - this.postureInvalidSince),
    };
  }
}
