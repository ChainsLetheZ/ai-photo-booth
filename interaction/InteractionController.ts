import { interactionConfig } from '../config/interactionConfig';
import { BehaviorFeatureExtractor } from '../behavior/BehaviorFeatureExtractor';
import type { BehaviorFeatures } from '../behavior/types';
import { evaluateGesture, type GestureRuleResult } from '../gestures/GestureRules';
import {
  GestureStabilityTracker,
  type StabilityResult,
} from '../gestures/GestureStabilityTracker';
import { PerceptionManager } from '../perception/PerceptionManager';
import type {
  PerceptionFrame,
  PerceptionSnapshot,
} from '../perception/types';
import type {
  GroupMode,
  PrimaryEnergy,
  SecondaryDimension,
} from '../types';
import { groupModeFromPersonCount } from './groupModes';
import {
  InteractionStateMachine,
  type InteractionState,
} from './InteractionStateMachine';
import {
  scoreSecondaryDimensions,
  selectSecondaryDimension,
  type SecondaryScores,
} from './SecondaryRuleEngine';

const EMPTY_FEATURES: BehaviorFeatures = {
  personCount: 0,
  armsOpen: false,
  handsConverged: false,
  handsTowardCenter: false,
  peopleClose: false,
  groupCohesion: 0,
  movementIntensity: 0,
  movementSynchrony: undefined,
  spatialExploration: 0,
  stability: 1,
  poseReady: false,
  allSubjectsInFrame: false,
  detectionStable: false,
};

export interface InteractionEngineSnapshot {
  state: InteractionState;
  perception: PerceptionSnapshot;
  features: BehaviorFeatures;
  frame: PerceptionFrame | null;
  mode: GroupMode;
  primary: PrimaryEnergy | null;
  secondary: SecondaryDimension | null;
  secondaryScores: SecondaryScores | null;
  gesture: GestureRuleResult | null;
  stability: StabilityResult;
  fallbackAvailable: boolean;
}

export type VisionInteractionEvent =
  | { type: 'PARTICIPANT_ENTERED'; timestamp: number }
  | { type: 'PARTICIPANT_LEFT'; timestamp: number }
  | { type: 'GROUP_SIZE_CHANGED'; timestamp: number; personCount: number }
  | { type: 'GESTURE_CONFIRMED'; timestamp: number }
  | { type: 'POSE_READY'; timestamp: number }
  | { type: 'TRACKING_LOST'; timestamp: number };

export class InteractionController {
  readonly machine = new InteractionStateMachine();
  private readonly extractor = new BehaviorFeatureExtractor();
  private readonly stabilityTracker = new GestureStabilityTracker();
  private readonly perceptionManager: PerceptionManager;
  private perception: PerceptionSnapshot = { status: 'idle', frame: null };
  private features: BehaviorFeatures = EMPTY_FEATURES;
  private frame: PerceptionFrame | null = null;
  private mode: GroupMode = 'Single';
  private primary: PrimaryEnergy | null = null;
  private secondary: SecondaryDimension | null = null;
  private secondaryScores: SecondaryScores | null = null;
  private gesture: GestureRuleResult | null = null;
  private stability: StabilityResult = {
    confirmed: false,
    progress: 0,
    trackingLost: false,
  };
  private fallbackAvailable = false;
  private fallbackTimer = 0;
  private presenceTimer = 0;
  private lastPersonCount = 0;
  private missingSince: number | null = null;
  private trackingLossEmitted = false;
  private participantWasPresent = false;
  private visionEventListeners = new Set<
    (event: VisionInteractionEvent) => void
  >();

  constructor(
    video: HTMLVideoElement,
    private readonly listener: (snapshot: InteractionEngineSnapshot) => void,
  ) {
    this.perceptionManager = new PerceptionManager(
      video,
      this.handlePerception,
    );
    this.machine.subscribe(this.handleStateChange);
  }

  async start() {
    await this.perceptionManager.start();
  }

  close() {
    window.clearTimeout(this.fallbackTimer);
    window.clearTimeout(this.presenceTimer);
    this.perceptionManager.close();
  }

  subscribeToVisionEvents(
    listener: (event: VisionInteractionEvent) => void,
  ) {
    this.visionEventListeners.add(listener);
    return () => this.visionEventListeners.delete(listener);
  }

  cameraReady() {
    this.machine.dispatch('CAMERA_READY');
  }

  startExperience() {
    this.machine.dispatch('START');
  }

  selectPrimary(primary: PrimaryEnergy) {
    this.primary = primary;
    this.machine.dispatch('PRIMARY_SELECTED');
    this.emit();
  }

  completeAnalysis() {
    const scores = scoreSecondaryDimensions(this.features);
    const selection = selectSecondaryDimension(scores);
    this.secondaryScores = scores;
    this.secondary = selection.dimension;
    this.machine.dispatch('ANALYSIS_COMPLETE');
    this.emit();
    return selection;
  }

  completeResponse() {
    this.machine.dispatch('RESPONSE_COMPLETE');
  }

  beginActionTracking() {
    this.machine.dispatch('INSTRUCTION_SHOWN');
  }

  continueWithTouchFallback() {
    this.machine.dispatch('FALLBACK_CONTINUE');
  }

  beginCountdown() {
    this.machine.dispatch('START_COUNTDOWN');
  }

  countdownComplete() {
    this.machine.dispatch('COUNTDOWN_COMPLETE');
  }

  captureComplete() {
    this.machine.dispatch('CAPTURE_COMPLETE');
  }

  generationComplete() {
    this.machine.dispatch('GENERATION_COMPLETE');
  }

  beginCollectivePush() {
    this.machine.dispatch('PUSH_COLLECTIVE');
  }

  collectiveComplete() {
    this.machine.dispatch('COLLECTIVE_COMPLETE');
  }

  fail() {
    this.machine.dispatch('FAIL');
  }

  reset() {
    this.primary = null;
    this.secondary = null;
    this.secondaryScores = null;
    this.mode = 'Single';
    this.gesture = null;
    this.stabilityTracker.reset();
    this.extractor.reset();
    this.features = EMPTY_FEATURES;
    this.fallbackAvailable = false;
    this.machine.dispatch('RESET');
    this.emit();
  }

  getSnapshot(): InteractionEngineSnapshot {
    return {
      state: this.machine.getState(),
      perception: this.perception,
      features: this.features,
      frame: this.frame,
      mode: this.mode,
      primary: this.primary,
      secondary: this.secondary,
      secondaryScores: this.secondaryScores,
      gesture: this.gesture,
      stability: this.stability,
      fallbackAvailable: this.fallbackAvailable,
    };
  }

  private handlePerception = (perception: PerceptionSnapshot) => {
    this.perception = perception;
    if (perception.frame) {
      this.frame = perception.frame;
      this.features = this.extractor.extract(perception.frame);
      this.mode = groupModeFromPersonCount(this.features.personCount);
      this.emitPresenceEvents(perception.frame);
      if (
        this.features.personCount > 0 &&
        (this.machine.getState() === 'IDLE' ||
          this.machine.getState() === 'AWAITING_START')
      ) {
        this.machine.dispatch('PARTICIPANT_ENTERED');
        window.clearTimeout(this.presenceTimer);
        this.presenceTimer = window.setTimeout(
          () => this.machine.dispatch('PRESENCE_ACKNOWLEDGED'),
          550,
        );
      }
      if (this.machine.getState() === 'ACTION_TRACKING') {
        this.gesture = evaluateGesture(this.mode, this.features);
        this.stability = this.stabilityTracker.update(
          this.gesture.satisfied,
          this.features.personCount > 0,
          perception.frame.timestamp,
        );
        this.features = {
          ...this.features,
          poseReady: this.stability.confirmed,
        };
        if (this.stability.confirmed) {
          this.emitVisionEvent({
            type: 'GESTURE_CONFIRMED',
            timestamp: perception.frame.timestamp,
          });
          this.machine.dispatch('GESTURE_CONFIRMED');
          this.emitVisionEvent({
            type: 'POSE_READY',
            timestamp: perception.frame.timestamp,
          });
        }
      }
    }
    this.emit();
  };

  private handleStateChange = (state: InteractionState) => {
    window.clearTimeout(this.fallbackTimer);
    if (state === 'ACTION_TRACKING') {
      this.stabilityTracker.reset();
      this.fallbackAvailable = false;
      this.fallbackTimer = window.setTimeout(() => {
        this.fallbackAvailable = true;
        this.emit();
      }, interactionConfig.gestureFallbackMs);
    }
    if (state === 'POSE_READY') {
      this.fallbackAvailable = false;
    }
    this.emit();
  };

  private emit() {
    this.listener(this.getSnapshot());
  }

  private emitPresenceEvents(frame: PerceptionFrame) {
    const personCount = this.features.personCount;
    if (personCount !== this.lastPersonCount) {
      this.emitVisionEvent({
        type: 'GROUP_SIZE_CHANGED',
        timestamp: frame.timestamp,
        personCount,
      });
    }
    if (personCount > 0) {
      if (this.lastPersonCount === 0) {
        this.emitVisionEvent({
          type: 'PARTICIPANT_ENTERED',
          timestamp: frame.timestamp,
        });
      }
      this.missingSince = null;
      this.trackingLossEmitted = false;
      this.participantWasPresent = true;
    } else {
      if (this.missingSince === null) this.missingSince = frame.timestamp;
      if (
        !this.trackingLossEmitted &&
        frame.timestamp - this.missingSince >
          interactionConfig.trackingLossGraceMs
      ) {
        this.trackingLossEmitted = true;
        this.emitVisionEvent({
          type: 'TRACKING_LOST',
          timestamp: frame.timestamp,
        });
        if (this.participantWasPresent) {
          this.emitVisionEvent({
            type: 'PARTICIPANT_LEFT',
            timestamp: frame.timestamp,
          });
          this.participantWasPresent = false;
        }
      }
    }
    this.lastPersonCount = personCount;
  }

  private emitVisionEvent(event: VisionInteractionEvent) {
    this.visionEventListeners.forEach((listener) => listener(event));
  }
}
