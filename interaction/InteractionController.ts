import { BehaviorFeatureExtractor } from '../behavior/BehaviorFeatureExtractor';
import type { BehaviorFeatures } from '../behavior/types';
import { interactionConfig } from '../config/interactionConfig';
import {
  evaluateRaiseArm,
  type GestureRuleResult,
} from '../gestures/GestureRules';
import {
  GestureStabilityTracker,
  type StabilityResult,
} from '../gestures/GestureStabilityTracker';
import { PerceptionManager } from '../perception/PerceptionManager';
import { latestRenderMs } from '../perception/RenderTimingStore';
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
import {
  emptyZoneSnapshot,
  type ZoneSnapshot,
  ZoneTracker,
} from './ZoneTracker';
import {
  PersonTrackStore,
  type BodyScaleProbeSnapshot,
} from './PersonTrackStore';

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

const EMPTY_STABILITY: StabilityResult = {
  confirmed: false,
  progress: 0,
  trackingLost: false,
};

export interface InteractionEngineSnapshot {
  state: InteractionState;
  perception: PerceptionSnapshot;
  frame: PerceptionFrame | null;
  zones: ZoneSnapshot;
  features: BehaviorFeatures;
  mode: GroupMode;
  primary: PrimaryEnergy;
  secondary: SecondaryDimension | null;
  secondaryScores: SecondaryScores | null;
  gesture: GestureRuleResult | null;
  stability: StabilityResult;
  initiatorId: string | null;
  gestureConfirmedAt: number | null;
  lockedActiveIds: string[];
  countdown: number | null;
  bodyScaleProbe: BodyScaleProbeSnapshot | null;
}

interface InteractionControllerOptions {
  enableBodyScaleProbe?: boolean;
}

function sameIds(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  const secondSet = new Set(second);
  return first.every((id) => secondSet.has(id));
}

export class InteractionController {
  readonly machine = new InteractionStateMachine();
  private readonly extractor = new BehaviorFeatureExtractor();
  private readonly stabilityTracker = new GestureStabilityTracker();
  private readonly zoneTracker = new ZoneTracker();
  private readonly perceptionManager: PerceptionManager;
  private perception: PerceptionSnapshot = { status: 'idle', frame: null };
  private frame: PerceptionFrame | null = null;
  private zones: ZoneSnapshot = emptyZoneSnapshot();
  private features: BehaviorFeatures = EMPTY_FEATURES;
  private mode: GroupMode = 'Single';
  private primary: PrimaryEnergy = interactionConfig.defaultPrimary;
  private secondary: SecondaryDimension | null = null;
  private secondaryScores: SecondaryScores | null = null;
  private gesture: GestureRuleResult | null = null;
  private stability: StabilityResult = EMPTY_STABILITY;
  private initiatorId: string | null = null;
  private gestureConfirmedAt: number | null = null;
  private lockedActiveIds: string[] = [];
  private countdown: number | null = null;
  private bodyScaleSnapshot: BodyScaleProbeSnapshot | null = null;
  private readonly personTrackStore = new PersonTrackStore();
  private readonly bodyScaleDebugEnabled: boolean;
  private missingLockedSince: number | null = null;
  private directTimer = 0;
  private readyTimer = 0;
  private countdownTimer = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly listener: (snapshot: InteractionEngineSnapshot) => void,
    options: InteractionControllerOptions = {},
  ) {
    this.bodyScaleDebugEnabled = Boolean(
      options.enableBodyScaleProbe && interactionConfig.bodyScaleProbe.enabled,
    );
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
    this.clearTimers();
    this.personTrackStore.reset();
    this.perceptionManager.close();
  }

  captureComplete() {
    this.machine.dispatch('CAPTURE_COMPLETE');
  }

  generationComplete() {
    this.machine.dispatch('CREATE_COMPLETE');
  }

  fail() {
    this.machine.dispatch('FAIL');
  }

  reset() {
    this.clearTimers();
    this.primary = interactionConfig.defaultPrimary;
    this.secondary = null;
    this.secondaryScores = null;
    this.mode = 'Single';
    this.gesture = null;
    this.stability = EMPTY_STABILITY;
    this.initiatorId = null;
    this.gestureConfirmedAt = null;
    this.lockedActiveIds = [];
    this.countdown = null;
    this.missingLockedSince = null;
    this.stabilityTracker.reset();
    this.extractor.reset();
    this.zoneTracker.reset();
    this.personTrackStore.reset();
    this.bodyScaleSnapshot = null;
    this.features = EMPTY_FEATURES;
    this.zones = emptyZoneSnapshot();
    this.machine.dispatch('RESET');
    this.emit();
  }

  getSnapshot(): InteractionEngineSnapshot {
    return {
      state: this.machine.getState(),
      perception: this.perception,
      frame: this.frame,
      zones: this.zones,
      features: this.features,
      mode: this.mode,
      primary: this.primary,
      secondary: this.secondary,
      secondaryScores: this.secondaryScores,
      gesture: this.gesture,
      stability: this.stability,
      initiatorId: this.initiatorId,
      gestureConfirmedAt: this.gestureConfirmedAt,
      lockedActiveIds: this.lockedActiveIds,
      countdown: this.countdown,
      bodyScaleProbe: this.bodyScaleSnapshot,
    };
  }

  private handlePerception = (perception: PerceptionSnapshot) => {
    this.perception = perception;
    if (perception.frame) {
      const controllerPostStarted = performance.now();
      const stabilized = this.personTrackStore.stabilize(
        perception.frame,
        this.video.videoWidth,
        this.video.videoHeight,
      );
      this.frame = stabilized.frame;
      this.perception = { ...perception, frame: stabilized.frame };
      const scaleDecisionSnapshot = this.personTrackStore.measure(
        stabilized.frame,
        this.zones,
        this.video.videoWidth,
        this.video.videoHeight,
      );
      this.zones = this.zoneTracker.update(
        stabilized.frame,
        scaleDecisionSnapshot.readings,
      );
      const activeFrame: PerceptionFrame = {
        ...stabilized.frame,
        people: this.zones.activePeople,
        hands: [],
      };
      this.features = this.extractor.extract(activeFrame);
      this.mode = groupModeFromPersonCount(this.features.personCount);
      this.synchronizeSpatialState(stabilized.frame.timestamp);
      if (this.machine.getState() === 'DIRECT') {
        this.updateGesture(stabilized.frame.timestamp);
      }
      if (
        this.machine.getState() === 'POSE_READY' ||
        this.machine.getState() === 'COUNTDOWN'
      ) {
        this.validateLockedGroup(stabilized.frame.timestamp);
      }
      const baseTiming = stabilized.frame.timing ?? {
        captureMs: 0,
        inferMs: stabilized.frame.inferenceMs,
        postMs: 0,
        renderMs: 0,
        totalMs: stabilized.frame.inferenceMs,
      };
      const postMs =
        baseTiming.postMs +
        (performance.now() - controllerPostStarted);
      const renderMs = latestRenderMs();
      const timing = {
        ...baseTiming,
        postMs,
        renderMs,
        totalMs:
          baseTiming.captureMs +
          baseTiming.inferMs +
          postMs +
          renderMs,
      };
      const timedFrame: PerceptionFrame = {
        ...stabilized.frame,
        inferenceMs: timing.inferMs,
        timing,
      };
      this.frame = timedFrame;
      this.perception = { ...perception, frame: timedFrame };
      this.updateBodyScaleProbe(scaleDecisionSnapshot, timedFrame);
    }
    this.emit();
  };

  private synchronizeSpatialState(timestamp: number) {
    const state = this.machine.getState();
    if (
      state === 'CAPTURE' ||
      state === 'CREATE' ||
      state === 'RESULT' ||
      state === 'ERROR'
    ) {
      return;
    }

    if (
      this.zones.engagedPeople.length === 0 &&
      this.lockedPeopleAreBrieflyMissing(timestamp)
    ) {
      return;
    }

    if (this.zones.engagedPeople.length === 0) {
      this.cancelInteractionMemory();
      this.machine.dispatch('ENGAGEMENT_LOST');
      return;
    }

    if (
      this.zones.capturePeople.length === 0 &&
      this.lockedPeopleAreBrieflyMissing(timestamp)
    ) {
      return;
    }

    if (this.zones.capturePeople.length === 0) {
      this.cancelInteractionMemory();
      if (state === 'PASSERBY') {
        this.machine.dispatch('ENGAGEMENT_FOUND');
      } else if (
        state === 'CAPTURE_ZONE' ||
        state === 'DIRECT' ||
        state === 'POSE_READY' ||
        state === 'COUNTDOWN'
      ) {
        this.machine.dispatch('CAPTURE_ZONE_LEFT');
      }
      return;
    }

    if (state === 'PASSERBY' || state === 'ENGAGED') {
      this.machine.dispatch('CAPTURE_ZONE_ENTERED');
    }

    const currentState = this.machine.getState();
    const groupInvalid =
      this.zones.overflow ||
      !this.zones.activeStable ||
      this.zones.activePeople.length === 0;

    if (groupInvalid) {
      if (this.lockedPeopleAreBrieflyMissing(timestamp)) return;
      window.clearTimeout(this.directTimer);
      this.directTimer = 0;
      if (
        currentState === 'DIRECT' ||
        currentState === 'POSE_READY' ||
        currentState === 'COUNTDOWN'
      ) {
        this.cancelInteractionMemory();
        this.machine.dispatch('CAPTURE_INVALID');
      }
      return;
    }

    if (currentState === 'CAPTURE_ZONE') {
      this.ensureDirectTimer(timestamp);
    }
  }

  private ensureDirectTimer(_timestamp: number) {
    if (this.directTimer) return;
    this.directTimer = window.setTimeout(() => {
      this.directTimer = 0;
      if (
        this.machine.getState() !== 'CAPTURE_ZONE' ||
        this.zones.overflow ||
        !this.zones.activeStable ||
        this.zones.activePeople.length === 0
      ) {
        return;
      }
      this.lockedActiveIds = [...this.zones.activeIds];
      this.secondaryScores = scoreSecondaryDimensions(this.features);
      this.secondary = selectSecondaryDimension(
        this.secondaryScores,
      ).dimension;
      this.machine.dispatch('START_DIRECT');
      this.emit();
    }, interactionConfig.directLeadInMs);
  }

  private updateGesture(timestamp: number) {
    if (!this.zones.activeStable || this.zones.overflow) return;

    let result = evaluateRaiseArm(
      this.zones.activePeople,
      this.initiatorId,
    );
    if (!this.initiatorId && result.initiatorId) {
      this.initiatorId = result.initiatorId;
      result = evaluateRaiseArm(
        this.zones.activePeople,
        this.initiatorId,
      );
    }
    if (
      this.initiatorId &&
      result.matchScore < interactionConfig.raiseArmStartScore * 0.45 &&
      this.stability.progress === 0
    ) {
      this.initiatorId = null;
      this.stabilityTracker.reset();
      result = evaluateRaiseArm(this.zones.activePeople);
    }
    result = {
      ...result,
      satisfied: result.satisfied && this.features.allSubjectsInFrame,
    };
    this.gesture = result;
    this.stability = this.stabilityTracker.update(
      result.satisfied,
      this.zones.activePeople.length > 0,
      timestamp,
    );
    this.features = {
      ...this.features,
      poseReady: this.stability.confirmed,
    };
    if (this.stability.confirmed) {
      this.gestureConfirmedAt = performance.now();
      this.machine.dispatch('GESTURE_CONFIRMED');
    }
  }

  private validateLockedGroup(timestamp: number) {
    const valid =
      !this.zones.overflow &&
      this.zones.activeStable &&
      this.zones.activePeople.length > 0 &&
      sameIds(this.lockedActiveIds, this.zones.activeIds) &&
      this.features.allSubjectsInFrame;
    if (!valid && this.lockedPeopleAreBrieflyMissing(timestamp)) return;
    if (!valid) {
      this.cancelInteractionMemory();
      this.machine.dispatch('CAPTURE_INVALID');
    }
  }

  private handleStateChange = (state: InteractionState) => {
    if (state !== 'CAPTURE_ZONE') {
      window.clearTimeout(this.directTimer);
      this.directTimer = 0;
    }
    if (state !== 'POSE_READY') {
      window.clearTimeout(this.readyTimer);
      this.readyTimer = 0;
    }
    if (state !== 'COUNTDOWN') {
      this.stopCountdown();
    }

    if (state === 'DIRECT') {
      this.gesture = null;
      this.stability = EMPTY_STABILITY;
      this.initiatorId = null;
      this.gestureConfirmedAt = null;
      this.stabilityTracker.reset();
    }
    if (state === 'POSE_READY') {
      this.readyTimer = window.setTimeout(() => {
        this.readyTimer = 0;
        if (
          this.machine.getState() === 'POSE_READY' &&
          sameIds(this.lockedActiveIds, this.zones.activeIds)
        ) {
          this.machine.dispatch('START_COUNTDOWN');
        }
      }, interactionConfig.readyHoldMs);
    }
    if (state === 'COUNTDOWN') {
      this.startCountdown();
    }
    this.emit();
  };

  private startCountdown() {
    this.stopCountdown();
    this.countdown = 3;
    this.countdownTimer = window.setInterval(() => {
      if (this.machine.getState() !== 'COUNTDOWN') {
        this.stopCountdown();
        return;
      }
      const next = (this.countdown ?? 3) - 1;
      if (next <= 0) {
        this.stopCountdown();
        this.machine.dispatch('COUNTDOWN_COMPLETE');
      } else {
        this.countdown = next;
        this.emit();
      }
    }, 1000);
  }

  private stopCountdown() {
    window.clearInterval(this.countdownTimer);
    this.countdownTimer = 0;
    this.countdown = null;
  }

  private cancelInteractionMemory() {
    this.stopCountdown();
    window.clearTimeout(this.readyTimer);
    this.readyTimer = 0;
    this.lockedActiveIds = [];
    this.initiatorId = null;
    this.gestureConfirmedAt = null;
    this.gesture = null;
    this.stability = EMPTY_STABILITY;
    this.missingLockedSince = null;
    this.stabilityTracker.reset();
  }

  private clearTimers() {
    window.clearTimeout(this.directTimer);
    window.clearTimeout(this.readyTimer);
    this.directTimer = 0;
    this.readyTimer = 0;
    this.stopCountdown();
  }

  private lockedPeopleAreBrieflyMissing(timestamp: number) {
    if (!this.lockedActiveIds.length || !this.frame) {
      this.missingLockedSince = null;
      return false;
    }
    const visibleIds = new Set(this.frame.people.map((person) => person.id));
    const hasMissingLockedPerson = this.lockedActiveIds.some(
      (id) => !visibleIds.has(id),
    );
    if (!hasMissingLockedPerson) {
      this.missingLockedSince = null;
      return false;
    }
    if (this.missingLockedSince === null) {
      this.missingLockedSince = timestamp;
    }
    return (
      timestamp - this.missingLockedSince <
      interactionConfig.trackingLossGraceMs
    );
  }

  private emit() {
    this.listener(this.getSnapshot());
  }

  private updateBodyScaleProbe(
    snapshot: BodyScaleProbeSnapshot,
    frame: PerceptionFrame,
  ) {
    if (!this.bodyScaleDebugEnabled) {
      this.bodyScaleSnapshot = null;
      return;
    }
    const annotated = this.personTrackStore.annotateZones(snapshot, this.zones);
    this.bodyScaleSnapshot = {
      ...annotated,
      readings: annotated.readings.map((reading) => ({
        ...reading,
        fps: frame.fps,
        inferenceMs: frame.inferenceMs,
        captureMs: frame.timing?.captureMs ?? 0,
        inferMs: frame.timing?.inferMs ?? frame.inferenceMs,
        postMs: frame.timing?.postMs ?? 0,
        renderMs: frame.timing?.renderMs ?? 0,
        totalMs: frame.timing?.totalMs ?? frame.inferenceMs,
      })),
    };
  }
}
