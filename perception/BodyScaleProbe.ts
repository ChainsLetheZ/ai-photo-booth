import { bodyScaleProbe as probeConfig } from '../config/interactionConfig';

export interface Pt {
  x: number;
  y: number;
  score?: number;
}

export const dist = (a: Pt, b: Pt): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const mid = (a: Pt, b: Pt): Pt => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export interface BodyScaleResult {
  scale: number | null;
  torso: number | null;
  shoulderWidth: number | null;
  reason: 'ok' | 'low_confidence' | 'missing_keypoint';
}

const REQUIRED_POINTS = [
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
] as const;

export function bodyScale(
  kp: Record<string, Pt | undefined>,
  minConf: number = probeConfig.minKeypointConfidence,
  shoulderWidthFactor: number = probeConfig.shoulderWidthFactor,
): BodyScaleResult {
  if (REQUIRED_POINTS.some((name) => kp[name] === undefined)) {
    return {
      scale: null,
      torso: null,
      shoulderWidth: null,
      reason: 'missing_keypoint',
    };
  }

  if (
    REQUIRED_POINTS.some((name) => {
      const score = kp[name]?.score;
      return score === undefined || score < minConf;
    })
  ) {
    return {
      scale: null,
      torso: null,
      shoulderWidth: null,
      reason: 'low_confidence',
    };
  }

  const leftShoulder = kp.leftShoulder!;
  const rightShoulder = kp.rightShoulder!;
  const leftHip = kp.leftHip!;
  const rightHip = kp.rightHip!;
  const torso = dist(
    mid(leftShoulder, rightShoulder),
    mid(leftHip, rightHip),
  );
  const shoulderWidth = dist(leftShoulder, rightShoulder);

  return {
    scale: Math.max(torso, shoulderWidth * shoulderWidthFactor),
    torso,
    shoulderWidth,
    reason: 'ok',
  };
}

const alpha = (dt: number, cutoff: number) =>
  1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuroFilter {
  private xPrev?: number;
  private dxPrev = 0;
  private tPrev?: number;

  constructor(
    private minCutoff: number = probeConfig.oneEuro.minCutoff,
    private beta: number = probeConfig.oneEuro.beta,
    private dCutoff: number = probeConfig.oneEuro.dCutoff,
  ) {}

  filter(x: number, tMs: number): number {
    if (this.tPrev === undefined) {
      this.tPrev = tMs;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    const dx = (x - this.xPrev!) / dt;
    const aD = alpha(dt, this.dCutoff);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = alpha(dt, cutoff);
    const xF = a * x + (1 - a) * this.xPrev!;
    this.xPrev = xF;
    this.tPrev = tMs;
    return xF;
  }

  reset() {
    this.xPrev = undefined;
    this.dxPrev = 0;
    this.tPrev = undefined;
  }
}

export class MedianWindow {
  private buf: number[] = [];

  constructor(private size: number = probeConfig.medianWindowSize) {}

  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset() {
    this.buf = [];
  }
}
