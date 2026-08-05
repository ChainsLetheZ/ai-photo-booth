export type SimpleFlowState =
  | 'IDLE'
  | 'PERCEIVING'
  | 'LOCKED'
  | 'COUNTDOWN'
  | 'CAPTURE'
  | 'RESULT';

export type RaisedHandSide = 'left' | 'right' | 'both' | null;

export interface SimpleFlowInput {
  personDetected: boolean;
  handRaised: boolean;
  handSide: RaisedHandSide;
  gestureConfirmed: boolean;
}

export interface SimpleFlowConfig {
  personPresentLatchMs: number;
  autoReadyMs: number;
  handRaisedBoostPerSec: number;
  gestureConfirmFillsRing: boolean;
  lockedFeedbackMs: number;
  countdownSeconds: number;
  resultHoldMs: number;
  cooldownMs: number;
}

export interface SimpleFlowSnapshot {
  state: SimpleFlowState;
  heldMs: number;
  ringProgress: number;
  baseRatePerSec: number;
  boostRatePerSec: number;
  handRaised: boolean;
  handSide: RaisedHandSide;
  gestureConfirmed: boolean;
  personPresent: boolean;
  lastSeenAgoMs: number | null;
  countdown: number | null;
  cooldownRemainingMs: number;
}

const EMPTY_INPUT: SimpleFlowInput = {
  personDetected: false,
  handRaised: false,
  handSide: null,
  gestureConfirmed: false,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export class SimpleFlowController {
  private state: SimpleFlowState = 'IDLE';
  private stateEnteredAt = 0;
  private lastUpdatedAt: number | null = null;
  private ringProgress = 0;
  private lastSeenAt: number | null = null;
  private personPresent = false;
  private cooldownUntil = 0;
  private input: SimpleFlowInput = EMPTY_INPUT;
  private listeners = new Set<
    (state: SimpleFlowState, previous: SimpleFlowState) => void
  >();

  constructor(private readonly config: SimpleFlowConfig) {}

  subscribe(
    listener: (state: SimpleFlowState, previous: SimpleFlowState) => void,
  ) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(now: number, input: SimpleFlowInput) {
    this.updatePresence(now, input.personDetected);
    this.input = input;

    const dtSeconds =
      this.lastUpdatedAt === null
        ? 0
        : Math.max(0, now - this.lastUpdatedAt) / 1000;
    this.lastUpdatedAt = now;

    if (this.state === 'IDLE') {
      if (now >= this.cooldownUntil && this.personPresent) {
        this.enter('PERCEIVING', now);
      }
      return this.getSnapshot(now);
    }

    if (this.state === 'PERCEIVING') {
      const baseRate = 1000 / this.config.autoReadyMs;
      const boost = input.handRaised
        ? this.config.handRaisedBoostPerSec
        : 0;
      this.ringProgress = clamp01(
        this.ringProgress + (baseRate + boost) * dtSeconds,
      );
      if (input.gestureConfirmed && this.config.gestureConfirmFillsRing) {
        this.ringProgress = 1;
      }
      if (this.ringProgress >= 1) this.enter('LOCKED', now);
      return this.getSnapshot(now);
    }

    if (
      this.state === 'LOCKED' &&
      now - this.stateEnteredAt >= this.config.lockedFeedbackMs
    ) {
      this.enter('COUNTDOWN', now);
    } else if (
      this.state === 'COUNTDOWN' &&
      now - this.stateEnteredAt >= this.config.countdownSeconds * 1000
    ) {
      this.enter('CAPTURE', now);
    } else if (
      this.state === 'RESULT' &&
      now - this.stateEnteredAt >= this.config.resultHoldMs
    ) {
      this.resetSession(now);
    }
    return this.getSnapshot(now);
  }

  manualShutter(now: number) {
    if (
      this.state === 'IDLE' ||
      this.state === 'PERCEIVING' ||
      this.state === 'LOCKED'
    ) {
      this.ringProgress = 1;
      this.enter('COUNTDOWN', now);
    }
    this.lastUpdatedAt = now;
    return this.getSnapshot(now);
  }

  generationComplete(now: number) {
    if (this.state === 'CAPTURE') this.enter('RESULT', now);
    return this.getSnapshot(now);
  }

  resetSession(now: number) {
    const previous = this.state;
    this.state = 'IDLE';
    this.stateEnteredAt = now;
    this.lastUpdatedAt = now;
    this.ringProgress = 0;
    this.lastSeenAt = null;
    this.personPresent = false;
    this.input = EMPTY_INPUT;
    this.cooldownUntil = now + this.config.cooldownMs;
    if (previous !== 'IDLE') this.notify(previous);
    return this.getSnapshot(now);
  }

  getSnapshot(now: number): SimpleFlowSnapshot {
    const elapsed = Math.max(0, now - this.stateEnteredAt);
    const countdown =
      this.state === 'COUNTDOWN'
        ? Math.max(
            1,
            Math.ceil(
              (this.config.countdownSeconds * 1000 - elapsed) / 1000,
            ),
          )
        : null;
    return {
      state: this.state,
      heldMs: elapsed,
      ringProgress: this.ringProgress,
      baseRatePerSec: 1000 / this.config.autoReadyMs,
      boostRatePerSec: this.input.handRaised
        ? this.config.handRaisedBoostPerSec
        : 0,
      handRaised: this.input.handRaised,
      handSide: this.input.handSide,
      gestureConfirmed: this.input.gestureConfirmed,
      personPresent: this.personPresent,
      lastSeenAgoMs:
        this.lastSeenAt === null ? null : Math.max(0, now - this.lastSeenAt),
      countdown,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
    };
  }

  private updatePresence(now: number, detected: boolean) {
    if (detected) {
      this.lastSeenAt = now;
      this.personPresent = true;
      return;
    }
    if (
      this.lastSeenAt === null ||
      now - this.lastSeenAt >= this.config.personPresentLatchMs
    ) {
      this.personPresent = false;
    }
  }

  private enter(state: SimpleFlowState, now: number) {
    if (state === this.state) return;
    const previous = this.state;
    this.state = state;
    this.stateEnteredAt = now;
    if (state === 'PERCEIVING') this.ringProgress = 0;
    this.notify(previous);
  }

  private notify(previous: SimpleFlowState) {
    this.listeners.forEach((listener) => listener(this.state, previous));
  }
}
