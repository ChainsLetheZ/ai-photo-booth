export type InteractionState =
  | 'PASSERBY'
  | 'ENGAGED'
  | 'CAPTURE_ZONE'
  | 'DIRECT'
  | 'POSE_READY'
  | 'COUNTDOWN'
  | 'CAPTURE'
  | 'CREATE'
  | 'RESULT'
  | 'ERROR';

export type InteractionEvent =
  | 'ENGAGEMENT_FOUND'
  | 'ENGAGEMENT_LOST'
  | 'CAPTURE_ZONE_ENTERED'
  | 'CAPTURE_ZONE_LEFT'
  | 'START_DIRECT'
  | 'GESTURE_CONFIRMED'
  | 'START_COUNTDOWN'
  | 'AUTO_COUNTDOWN'
  | 'MANUAL_SHUTTER'
  | 'CAPTURE_INVALID'
  | 'COUNTDOWN_COMPLETE'
  | 'CAPTURE_COMPLETE'
  | 'CREATE_COMPLETE'
  | 'RESET'
  | 'FAIL';

const transitions: Partial<
  Record<InteractionState, Partial<Record<InteractionEvent, InteractionState>>>
> = {
  PASSERBY: {
    ENGAGEMENT_FOUND: 'ENGAGED',
    CAPTURE_ZONE_ENTERED: 'CAPTURE_ZONE',
    MANUAL_SHUTTER: 'COUNTDOWN',
    FAIL: 'ERROR',
  },
  ENGAGED: {
    ENGAGEMENT_LOST: 'PASSERBY',
    CAPTURE_ZONE_ENTERED: 'CAPTURE_ZONE',
    MANUAL_SHUTTER: 'COUNTDOWN',
    FAIL: 'ERROR',
  },
  CAPTURE_ZONE: {
    CAPTURE_ZONE_LEFT: 'ENGAGED',
    ENGAGEMENT_LOST: 'PASSERBY',
    START_DIRECT: 'DIRECT',
    MANUAL_SHUTTER: 'COUNTDOWN',
    FAIL: 'ERROR',
  },
  DIRECT: {
    CAPTURE_INVALID: 'CAPTURE_ZONE',
    CAPTURE_ZONE_LEFT: 'ENGAGED',
    ENGAGEMENT_LOST: 'PASSERBY',
    GESTURE_CONFIRMED: 'POSE_READY',
    AUTO_COUNTDOWN: 'COUNTDOWN',
    MANUAL_SHUTTER: 'COUNTDOWN',
    FAIL: 'ERROR',
  },
  POSE_READY: {
    CAPTURE_INVALID: 'CAPTURE_ZONE',
    CAPTURE_ZONE_LEFT: 'ENGAGED',
    ENGAGEMENT_LOST: 'PASSERBY',
    START_COUNTDOWN: 'COUNTDOWN',
    MANUAL_SHUTTER: 'COUNTDOWN',
    FAIL: 'ERROR',
  },
  COUNTDOWN: {
    CAPTURE_INVALID: 'CAPTURE_ZONE',
    CAPTURE_ZONE_LEFT: 'ENGAGED',
    ENGAGEMENT_LOST: 'PASSERBY',
    COUNTDOWN_COMPLETE: 'CAPTURE',
    FAIL: 'ERROR',
  },
  CAPTURE: { CAPTURE_COMPLETE: 'CREATE', FAIL: 'ERROR' },
  CREATE: { CREATE_COMPLETE: 'RESULT', FAIL: 'ERROR' },
  RESULT: { RESET: 'PASSERBY' },
  ERROR: { RESET: 'PASSERBY' },
};

export class InteractionStateMachine {
  private state: InteractionState = 'PASSERBY';
  private listeners = new Set<(state: InteractionState) => void>();

  getState() {
    return this.state;
  }

  dispatch(event: InteractionEvent) {
    if (event === 'RESET') {
      this.state = 'PASSERBY';
      this.notify();
      return this.state;
    }
    if (event === 'FAIL' && this.state !== 'ERROR') {
      this.state = 'ERROR';
      this.notify();
      return this.state;
    }
    const next = transitions[this.state]?.[event];
    if (!next || next === this.state) return this.state;
    this.state = next;
    this.notify();
    return this.state;
  }

  subscribe(listener: (state: InteractionState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.state));
  }
}
