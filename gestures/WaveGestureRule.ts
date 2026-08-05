import { interactionConfig } from '../config/interactionConfig';
import type { Landmark, PersonObservation } from '../perception/types';

export type WaveSide = 'left' | 'right';

export interface WaveState {
  active: boolean;
  crossings: number;
  amplitude: number;
  progress: number;
  confirmed: boolean;
  side: WaveSide | null;
  lastCrossingAt: number | null;
  released: boolean;
}

export interface WaveGestureThresholds {
  minCrossings: number;
  minAmplitude: number;
  wristAboveShoulderRatio?: number;
}

interface WaveSample {
  timestampMs: number;
  nx: number;
}

interface SideWindow {
  samples: WaveSample[];
  crossings: number;
  lastCrossingAt: number | null;
}

const EMPTY_STATE: WaveState = {
  active: false,
  crossings: 0,
  amplitude: 0,
  progress: 0,
  confirmed: false,
  side: null,
  lastCrossingAt: null,
  released: false,
};

function confidence(point: Landmark | undefined) {
  if (!point) return 0;
  return Math.min(point.visibility ?? 1, point.presence ?? 1);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index];
}

function crossingCount(values: number[], center: number) {
  let previousSide = 0;
  let crossings = 0;
  values.forEach((value) => {
    const side =
      value < center - interactionConfig.waveGesture.deadzone
        ? -1
        : value > center + interactionConfig.waveGesture.deadzone
          ? 1
          : 0;
    if (side === 0) return;
    if (previousSide !== 0 && side !== previousSide) crossings += 1;
    previousSide = side;
  });
  return crossings;
}

function sidePoints(person: PersonObservation, side: WaveSide) {
  return side === 'left'
    ? {
        shoulder: person.keypoints.leftShoulder,
        elbow: person.keypoints.leftElbow,
        wrist: person.keypoints.leftWrist,
      }
    : {
        shoulder: person.keypoints.rightShoulder,
        elbow: person.keypoints.rightElbow,
        wrist: person.keypoints.rightWrist,
      };
}

/** Per-person MoveNet wave detector. All positions are normalized by shoulder width. */
export class WaveGestureRule {
  private readonly windows: Record<WaveSide, SideWindow> = {
    left: { samples: [], crossings: 0, lastCrossingAt: null },
    right: { samples: [], crossings: 0, lastCrossingAt: null },
  };

  constructor(
    private readonly thresholds: WaveGestureThresholds = {
      minCrossings: interactionConfig.waveGesture.minCrossings,
      minAmplitude: interactionConfig.waveGesture.minAmplitude,
    },
  ) {}

  update(person: PersonObservation, timestampMs: number): WaveState {
    const leftShoulder = person.keypoints.leftShoulder;
    const rightShoulder = person.keypoints.rightShoulder;
    if (
      confidence(leftShoulder) <
        interactionConfig.perception.minKeypointConfidence ||
      confidence(rightShoulder) <
        interactionConfig.perception.minKeypointConfidence
    ) {
      this.reset();
      return { ...EMPTY_STATE };
    }

    const shoulderWidth = Math.hypot(
      leftShoulder!.x - rightShoulder!.x,
      leftShoulder!.y - rightShoulder!.y,
    );
    if (shoulderWidth <= Number.EPSILON) {
      this.reset();
      return { ...EMPTY_STATE };
    }

    const states = (['left', 'right'] as const).map((side) =>
      this.updateSide(person, side, shoulderWidth, timestampMs),
    );
    return states.sort((first, second) => {
      if (first.confirmed !== second.confirmed) return first.confirmed ? -1 : 1;
      if (first.crossings !== second.crossings) {
        return second.crossings - first.crossings;
      }
      return second.progress - first.progress;
    })[0];
  }

  reset() {
    (['left', 'right'] as const).forEach((side) => this.resetSide(side));
  }

  private updateSide(
    person: PersonObservation,
    side: WaveSide,
    shoulderWidth: number,
    timestampMs: number,
  ): WaveState {
    const { shoulder, elbow, wrist } = sidePoints(person, side);
    const threshold = interactionConfig.perception.minKeypointConfidence;
    const active =
      confidence(shoulder) >= threshold &&
      confidence(elbow) >= threshold &&
      confidence(wrist) >= threshold &&
      wrist!.y <
        shoulder!.y -
          shoulderWidth *
            (this.thresholds.wristAboveShoulderRatio ??
              interactionConfig.waveGesture.wristAboveShoulderRatio);
    if (!active) {
      this.resetSide(side);
      return { ...EMPTY_STATE };
    }

    const window = this.windows[side];
    const nx = (wrist!.x - shoulder!.x) / shoulderWidth;
    window.samples.push({ timestampMs, nx });
    window.samples = window.samples.filter(
      (sample) =>
        timestampMs - sample.timestampMs <= interactionConfig.waveGesture.windowMs,
    );

    const values = window.samples.map((sample) => sample.nx);
    const center = median(values);
    const crossings = crossingCount(values, center);
    if (crossings > window.crossings) window.lastCrossingAt = timestampMs;
    window.crossings = crossings;
    const amplitude = percentile(values, 0.9) - percentile(values, 0.1);
    const released =
      window.lastCrossingAt !== null &&
      timestampMs - window.lastCrossingAt >
        interactionConfig.waveGesture.releaseTimeoutMs;
    if (released) {
      this.resetSide(side);
      this.windows[side].samples.push({ timestampMs, nx });
      return {
        ...EMPTY_STATE,
        active: true,
        side,
        released: true,
      };
    }

    const crossingProgress = Math.min(
      1,
      crossings / Math.max(1, this.thresholds.minCrossings),
    );
    const amplitudeProgress = Math.min(
      1,
      amplitude / Math.max(0.001, this.thresholds.minAmplitude),
    );
    const confirmed =
      crossings >= this.thresholds.minCrossings &&
      amplitude >= this.thresholds.minAmplitude;
    return {
      active: true,
      crossings,
      amplitude,
      progress: Math.min(crossingProgress, amplitudeProgress),
      confirmed,
      side,
      lastCrossingAt: window.lastCrossingAt,
      released: false,
    };
  }

  private resetSide(side: WaveSide) {
    this.windows[side] = {
      samples: [],
      crossings: 0,
      lastCrossingAt: null,
    };
  }
}
