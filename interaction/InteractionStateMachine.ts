export type InteractionState =
  | 'IDLE'
  | 'PARTICIPANT_DETECTED'
  | 'AWAITING_START'
  | 'PRIMARY_SELECTION'
  | 'ANALYZING_BEHAVIOR'
  | 'AI_RESPONSE'
  | 'ACTION_INSTRUCTION'
  | 'ACTION_TRACKING'
  | 'POSE_READY'
  | 'COUNTDOWN'
  | 'CAPTURE'
  | 'GENERATING'
  | 'RESULT'
  | 'COLLECTIVE_PUSH'
  | 'COMPLETE'
  | 'ERROR';

export type InteractionEvent =
  | 'CAMERA_READY'
  | 'PARTICIPANT_ENTERED'
  | 'PRESENCE_ACKNOWLEDGED'
  | 'START'
  | 'PRIMARY_SELECTED'
  | 'ANALYSIS_COMPLETE'
  | 'RESPONSE_COMPLETE'
  | 'INSTRUCTION_SHOWN'
  | 'GESTURE_CONFIRMED'
  | 'FALLBACK_CONTINUE'
  | 'START_COUNTDOWN'
  | 'COUNTDOWN_COMPLETE'
  | 'CAPTURE_COMPLETE'
  | 'GENERATION_COMPLETE'
  | 'PUSH_COLLECTIVE'
  | 'COLLECTIVE_COMPLETE'
  | 'RESET'
  | 'FAIL';

const transitions: Partial<
  Record<InteractionState, Partial<Record<InteractionEvent, InteractionState>>>
> = {
  IDLE: {
    CAMERA_READY: 'AWAITING_START',
    PARTICIPANT_ENTERED: 'PARTICIPANT_DETECTED',
    START: 'PRIMARY_SELECTION',
    FAIL: 'ERROR',
  },
  PARTICIPANT_DETECTED: {
    PRESENCE_ACKNOWLEDGED: 'AWAITING_START',
    START: 'PRIMARY_SELECTION',
    FAIL: 'ERROR',
  },
  AWAITING_START: {
    PARTICIPANT_ENTERED: 'PARTICIPANT_DETECTED',
    START: 'PRIMARY_SELECTION',
    FAIL: 'ERROR',
  },
  PRIMARY_SELECTION: { PRIMARY_SELECTED: 'ANALYZING_BEHAVIOR', FAIL: 'ERROR' },
  ANALYZING_BEHAVIOR: { ANALYSIS_COMPLETE: 'AI_RESPONSE', FAIL: 'ERROR' },
  AI_RESPONSE: { RESPONSE_COMPLETE: 'ACTION_INSTRUCTION', FAIL: 'ERROR' },
  ACTION_INSTRUCTION: { INSTRUCTION_SHOWN: 'ACTION_TRACKING', FAIL: 'ERROR' },
  ACTION_TRACKING: {
    GESTURE_CONFIRMED: 'POSE_READY',
    FALLBACK_CONTINUE: 'POSE_READY',
    FAIL: 'ERROR',
  },
  POSE_READY: { START_COUNTDOWN: 'COUNTDOWN', FAIL: 'ERROR' },
  COUNTDOWN: { COUNTDOWN_COMPLETE: 'CAPTURE', FAIL: 'ERROR' },
  CAPTURE: { CAPTURE_COMPLETE: 'GENERATING', FAIL: 'ERROR' },
  GENERATING: { GENERATION_COMPLETE: 'RESULT', FAIL: 'ERROR' },
  RESULT: { PUSH_COLLECTIVE: 'COLLECTIVE_PUSH', RESET: 'IDLE' },
  COLLECTIVE_PUSH: { COLLECTIVE_COMPLETE: 'COMPLETE', FAIL: 'ERROR' },
  COMPLETE: { RESET: 'IDLE' },
  ERROR: { RESET: 'IDLE' },
};

export class InteractionStateMachine {
  private state: InteractionState = 'IDLE';
  private listeners = new Set<(state: InteractionState) => void>();

  getState() {
    return this.state;
  }

  dispatch(event: InteractionEvent) {
    if (event === 'RESET') {
      this.state = 'IDLE';
      this.notify();
      return this.state;
    }
    if (event === 'FAIL' && this.state !== 'ERROR') {
      this.state = 'ERROR';
      this.notify();
      return this.state;
    }
    const next = transitions[this.state]?.[event];
    if (!next) return this.state;
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
