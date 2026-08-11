import {
  BehaviorFeatureExtractor,
  subjectInFrameResult,
} from '../behavior/BehaviorFeatureExtractor';
import type { BehaviorFeatures } from '../behavior/types';
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import { simpleMode, simpleModeGesture } from '../config/simpleMode';
import {
  evaluateRaiseArm,
  type GestureRuleResult,
} from '../gestures/GestureRules';
import {
  GestureStabilityTracker,
  type StabilityResult,
} from '../gestures/GestureStabilityTracker';
import {
  WaveGestureRule,
  type WaveState,
} from '../gestures/WaveGestureRule';
import { PerceptionManager } from '../perception/PerceptionManager';
import { pipelineHealth } from '../perception/PipelineHealthStore';
import { latestRenderMs } from '../perception/RenderTimingStore';
import {
  MediaPipeGestureService,
  type HandGestureSnapshot,
} from '../perception/MediaPipeGestureService';
import type {
  PerceptionFrame,
  PerceptionSnapshot,
  PersonObservation,
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
  SimpleFlowController,
  type RaisedHandSide,
  type SimpleFlowSnapshot,
  type SimpleFlowState,
} from './SimpleFlowController';
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
  type FrameGateDiagnostics,
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
  state: InteractionState | SimpleFlowState;
  perception: PerceptionSnapshot;
  frame: PerceptionFrame | null;
  zones: ZoneSnapshot;
  features: BehaviorFeatures;
  mode: GroupMode;
  primary: PrimaryEnergy;
  secondary: SecondaryDimension | null;
  secondaryScores: SecondaryScores | null;
  gesture: GestureRuleResult | null;
  wave: WaveState | null;
  stability: StabilityResult;
  initiatorId: string | null;
  gestureConfirmedAt: number | null;
  lockedActiveIds: string[];
  countdown: number | null;
  bodyScaleProbe: BodyScaleProbeSnapshot | null;
  blockedBy: InteractionBlocker | null;
  simpleFlow: SimpleFlowSnapshot | null;
  handGesture: HandGestureSnapshot | null;
}

export interface InteractionBlocker {
  condition: string;
  reason: string;
}

interface InteractionControllerOptions {
  enableBodyScaleProbe?: boolean;
}

function sameIds(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  const secondSet = new Set(second);
  return first.every((id) => secondSet.has(id));
}

function hasRenderableKeypoint(person: PersonObservation) {
  return Object.values(person.keypoints).some(
    (point) =>
      point &&
      (point.visibility ?? point.presence ?? 1) >=
        interactionConfig.moveNet.scoreThreshold,
  );
}

function immediateRaisedHand(people: PersonObservation[]) {
  for (const person of people) {
    const leftShoulder = person.keypoints.leftShoulder;
    const rightShoulder = person.keypoints.rightShoulder;
    if (!leftShoulder || !rightShoulder) continue;
    const shoulderWidth = Math.hypot(
      rightShoulder.x - leftShoulder.x,
      rightShoulder.y - leftShoulder.y,
    );
    const tolerance =
      shoulderWidth * simpleModeGesture.wristAboveShoulderRatio;
    const leftWrist = person.keypoints.leftWrist;
    const rightWrist = person.keypoints.rightWrist;
    const left = Boolean(
      leftWrist &&
        (leftWrist.visibility ?? leftWrist.presence ?? 1) >=
          interactionConfig.moveNet.scoreThreshold &&
        leftWrist.y < leftShoulder.y + tolerance,
    );
    const right = Boolean(
      rightWrist &&
        (rightWrist.visibility ?? rightWrist.presence ?? 1) >=
          interactionConfig.moveNet.scoreThreshold &&
        rightWrist.y < rightShoulder.y + tolerance,
    );
    if (left || right) {
      return {
        raised: true,
        side: (left && right ? 'both' : left ? 'left' : 'right') as Exclude<
          RaisedHandSide,
          null
        >,
        personId: person.id,
      };
    }
  }
  return { raised: false, side: null, personId: null } as const;
}

export class InteractionController {
  readonly machine = new InteractionStateMachine();
  private readonly simpleFlow = new SimpleFlowController(simpleMode);
  private simpleFlowSnapshot: SimpleFlowSnapshot = this.simpleFlow.getSnapshot(0);
  private readonly extractor = new BehaviorFeatureExtractor(
    effectiveInteractionConfig.inFrameRequiredKeypoints,
  );
  private readonly stabilityTracker = new GestureStabilityTracker(
    simpleMode.enabled
      ? simpleModeGesture.raiseArmHoldMs
      : effectiveInteractionConfig.raiseArmHoldMs,
  );
  private readonly zoneTracker = new ZoneTracker(
    interactionConfig.zoneBypass.enabled,
    effectiveInteractionConfig.minPersonScaleRatio,
    effectiveInteractionConfig.activeGroupStableMs,
  );
  private readonly perceptionManager: PerceptionManager;
  private readonly handGestureService: MediaPipeGestureService;
  private handGestureSnapshot: HandGestureSnapshot | null = null;
  private perception: PerceptionSnapshot = { status: 'idle', frame: null };
  private frame: PerceptionFrame | null = null;
  private zones: ZoneSnapshot = emptyZoneSnapshot();
  private features: BehaviorFeatures = EMPTY_FEATURES;
  private mode: GroupMode = 'Single';
  private primary: PrimaryEnergy = interactionConfig.defaultPrimary;
  private secondary: SecondaryDimension | null = null;
  private secondaryScores: SecondaryScores | null = null;
  private gesture: GestureRuleResult | null = null;
  private wave: WaveState | null = null;
  private readonly waveRules = new Map<string, WaveGestureRule>();
  private readonly waveStates = new Map<string, WaveState>();
  private initiatorGesture: 'raise' | 'wave' | null = null;
  private initiatorWaveLastCrossingAt: number | null = null;
  private confirmedGesture: 'raise' | 'wave' | null = null;
  private stability: StabilityResult = EMPTY_STABILITY;
  private initiatorId: string | null = null;
  private gestureConfirmedAt: number | null = null;
  private lockedActiveIds: string[] = [];
  private countdown: number | null = null;
  private bodyScaleSnapshot: BodyScaleProbeSnapshot | null = null;
  private readonly personTrackStore = new PersonTrackStore(
    effectiveInteractionConfig.trackConfirmFrames,
  );
  private frameGateDiagnostics: FrameGateDiagnostics = {
    detectedCount: 0,
    sanityAcceptedCount: 0,
    sanityRejectedCount: 0,
    rejectReasons: {},
    confirmedCount: 0,
    confirmationProgressFrames: 0,
    requiredConfirmationFrames:
      effectiveInteractionConfig.trackConfirmFrames,
    reassociatedCount: 0,
  };
  private readonly bodyScaleDebugEnabled: boolean;
  private missingLockedSince: number | null = null;
  private directTimer = 0;
  private readyTimer = 0;
  private countdownTimer = 0;
  private gestureFallbackTimer = 0;
  private simpleTickTimer = 0;
  private simpleInput = {
    personDetected: false,
    handRaised: false,
    handSide: null as RaisedHandSide,
    gestureConfirmed: false,
  };

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly listener: (snapshot: InteractionEngineSnapshot) => void,
    options: InteractionControllerOptions = {},
  ) {
    this.bodyScaleDebugEnabled = Boolean(
      options.enableBodyScaleProbe && interactionConfig.bodyScaleProbe.enabled,
    );
    pipelineHealth.reset();
    pipelineHealth.setScoreThreshold(interactionConfig.moveNet.scoreThreshold);
    this.handGestureService = new MediaPipeGestureService(
      video,
      this.handleHandGesture,
    );
    this.handGestureSnapshot = this.handGestureService.getSnapshot();
    this.perceptionManager = new PerceptionManager(
      video,
      this.handlePerception,
    );
    this.machine.subscribe(this.handleStateChange);
    this.simpleFlow.subscribe(this.handleSimpleStateChange);
  }

  async start() {
    await this.perceptionManager.start();
    if (simpleMode.enabled) {
      void this.handGestureService.initialize();
      this.simpleTickTimer = window.setInterval(() => {
        this.advanceSimpleFlow(performance.now());
      }, 50);
    }
  }

  close() {
    this.clearTimers();
    this.resetWaveTracking();
    this.personTrackStore.reset();
    this.handGestureService.close();
    this.perceptionManager.close();
  }

  captureComplete() {
    if (simpleMode.enabled) return;
    this.machine.dispatch('CAPTURE_COMPLETE');
  }

  generationComplete() {
    if (simpleMode.enabled) {
      this.simpleFlowSnapshot = this.simpleFlow.generationComplete(
        performance.now(),
      );
      this.emit();
      return;
    }
    this.machine.dispatch('CREATE_COMPLETE');
  }

  fail() {
    if (simpleMode.enabled) {
      this.reset();
      return;
    }
    this.machine.dispatch('FAIL');
  }

  manualShutter() {
    if (simpleMode.enabled) {
      if (!simpleMode.allowManualShutter) return;
      this.lockedActiveIds = this.frame?.people.map((person) => person.id) ?? [];
      this.simpleFlowSnapshot = this.simpleFlow.manualShutter(performance.now());
      this.emit();
      return;
    }
    if (!effectiveInteractionConfig.manualShutterEnabled) return;
    const state = this.machine.getState();
    if (
      state === 'COUNTDOWN' ||
      state === 'CAPTURE' ||
      state === 'CREATE' ||
      state === 'RESULT' ||
      state === 'ERROR'
    ) {
      return;
    }
    this.lockedActiveIds = [...this.zones.activeIds];
    this.machine.dispatch('MANUAL_SHUTTER');
  }

  reset() {
    this.clearTimers();
    this.primary = interactionConfig.defaultPrimary;
    this.secondary = null;
    this.secondaryScores = null;
    this.mode = 'Single';
    this.gesture = null;
    this.resetWaveTracking();
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
    if (simpleMode.enabled) this.handGestureService.reset();
    this.frameGateDiagnostics = {
      detectedCount: 0,
      sanityAcceptedCount: 0,
      sanityRejectedCount: 0,
      rejectReasons: {},
      confirmedCount: 0,
      confirmationProgressFrames: 0,
      requiredConfirmationFrames:
        effectiveInteractionConfig.trackConfirmFrames,
      reassociatedCount: 0,
    };
    this.features = EMPTY_FEATURES;
    this.zones = emptyZoneSnapshot();
    this.simpleInput = {
      personDetected: false,
      handRaised: false,
      handSide: null,
      gestureConfirmed: false,
    };
    if (simpleMode.enabled) {
      this.simpleFlowSnapshot = this.simpleFlow.resetSession(performance.now());
    } else {
      this.machine.dispatch('RESET');
    }
    this.emit();
  }

  getSnapshot(): InteractionEngineSnapshot {
    return {
      state: simpleMode.enabled
        ? this.simpleFlowSnapshot.state
        : this.machine.getState(),
      perception: this.perception,
      frame: this.frame,
      zones: this.zones,
      features: this.features,
      mode: this.mode,
      primary: this.primary,
      secondary: this.secondary,
      secondaryScores: this.secondaryScores,
      gesture: this.gesture,
      wave: this.wave,
      stability: this.stability,
      initiatorId: this.initiatorId,
      gestureConfirmedAt: this.gestureConfirmedAt,
      lockedActiveIds: this.lockedActiveIds,
      countdown: simpleMode.enabled
        ? this.simpleFlowSnapshot.countdown
        : this.countdown,
      bodyScaleProbe: this.bodyScaleSnapshot,
      blockedBy: this.currentBlocker(),
      simpleFlow: simpleMode.enabled ? this.simpleFlowSnapshot : null,
      handGesture: simpleMode.enabled ? this.handGestureSnapshot : null,
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
      this.frameGateDiagnostics = stabilized.gateDiagnostics;
      const interactionFrame = simpleMode.enabled
        ? { ...stabilized.frame, people: stabilized.acceptedPeople }
        : stabilized.frame;
      this.frame = interactionFrame;
      this.perception = { ...perception, frame: interactionFrame };
      pipelineHealth.reportFrame(
        {
          rawPoseCount: stabilized.gateDiagnostics.detectedCount,
          modelPoseCount: perception.frame.diagnostics?.rawPoseCount,
          topPoseScore: perception.frame.diagnostics?.topPoseScore,
          minPoseScore: perception.frame.diagnostics?.minPoseScore,
          sanityDetail: stabilized.gateDiagnostics.rejectDetail,
          sanityAcceptedCount: stabilized.gateDiagnostics.sanityAcceptedCount,
          rejectReasons: stabilized.gateDiagnostics.rejectReasons,
          confirmedCount: stabilized.gateDiagnostics.confirmedCount,
          reassociatedCount: stabilized.gateDiagnostics.reassociatedCount,
          renderPeopleCount: interactionFrame.people.length,
          renderablePeopleCount:
            interactionFrame.people.filter(hasRenderableKeypoint).length,
          renderRequiresConfirmedTracks: !simpleMode.enabled,
        },
        perception.frame.timestamp,
      );
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
        ...interactionFrame,
        people: simpleMode.enabled
          ? interactionFrame.people
          : this.zones.activePeople,
        hands: [],
      };
      this.features = this.extractor.extract(activeFrame);
      this.mode = groupModeFromPersonCount(this.features.personCount);
      if (simpleMode.enabled) {
        this.updateSimpleSignals(stabilized.frame.timestamp);
        this.advanceSimpleFlow(stabilized.frame.timestamp);
      } else {
        this.synchronizeSpatialState(stabilized.frame.timestamp);
        if (this.machine.getState() === 'DIRECT') {
          this.updateGesture(stabilized.frame.timestamp);
        }
        if (
          this.machine.getState() === 'POSE_READY' ||
          (this.machine.getState() === 'COUNTDOWN' &&
            !effectiveInteractionConfig.countdownSkipValidation)
        ) {
          this.validateLockedGroup(stabilized.frame.timestamp);
        }
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
        ...interactionFrame,
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
      state === 'COUNTDOWN' &&
      effectiveInteractionConfig.countdownSkipValidation
    ) {
      return;
    }
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
    }, effectiveInteractionConfig.preGestureDelayMs);
  }

  private updateGesture(timestamp: number) {
    if (!this.zones.activeStable || this.zones.overflow) return;
    this.updateWaveStates(timestamp);

    let raiseResult = evaluateRaiseArm(
      this.zones.activePeople,
      this.initiatorId,
      effectiveInteractionConfig.raiseArmScoreThreshold,
    );
    if (!interactionConfig.gestureMode.acceptRaiseArm) {
      raiseResult = {
        requiredPrimitive: 'RAISE_ONE_ARM',
        satisfied: false,
        matchScore: 0,
        initiatorId: null,
        arm: null,
      };
    }

    if (!this.initiatorId && interactionConfig.gestureMode.acceptWave) {
      const waveCandidate = [...this.waveStates.entries()]
        .filter(([, state]) => state.crossings >= 1 && !state.released)
        .sort((first, second) => {
          const firstAt = first[1].lastCrossingAt ?? Number.POSITIVE_INFINITY;
          const secondAt = second[1].lastCrossingAt ?? Number.POSITIVE_INFINITY;
          return firstAt - secondAt;
        })[0];
      if (waveCandidate) {
        this.initiatorId = waveCandidate[0];
        this.initiatorGesture = 'wave';
        this.initiatorWaveLastCrossingAt = waveCandidate[1].lastCrossingAt;
      }
    }
    if (!this.initiatorId && raiseResult.initiatorId) {
      this.initiatorId = raiseResult.initiatorId;
      this.initiatorGesture = 'raise';
    }

    if (this.initiatorId) {
      raiseResult = evaluateRaiseArm(
        this.zones.activePeople,
        this.initiatorId,
        effectiveInteractionConfig.raiseArmScoreThreshold,
      );
      const initiatorWave = this.waveStates.get(this.initiatorId) ?? null;
      if (initiatorWave?.crossings) {
        this.initiatorGesture = 'wave';
        this.initiatorWaveLastCrossingAt =
          initiatorWave.lastCrossingAt ?? this.initiatorWaveLastCrossingAt;
      }
      const waveTimedOut =
        this.initiatorGesture === 'wave' &&
        this.initiatorWaveLastCrossingAt !== null &&
        timestamp - this.initiatorWaveLastCrossingAt >
          interactionConfig.waveGesture.releaseTimeoutMs;
      const raiseReleased =
        this.initiatorGesture === 'raise' &&
        raiseResult.matchScore < interactionConfig.raiseArmStartScore * 0.45 &&
        this.stability.progress === 0;
      if (waveTimedOut || raiseReleased) {
        this.initiatorId = null;
        this.initiatorGesture = null;
        this.initiatorWaveLastCrossingAt = null;
        this.wave = null;
        this.stabilityTracker.reset();
        raiseResult = evaluateRaiseArm(
          this.zones.activePeople,
          null,
          effectiveInteractionConfig.raiseArmScoreThreshold,
        );
      }
    }

    const initiatorWave =
      this.initiatorId && interactionConfig.gestureMode.acceptWave
        ? this.waveStates.get(this.initiatorId) ?? null
        : null;
    this.wave = initiatorWave;
    const framingSatisfied =
      !effectiveInteractionConfig.requireInFrame ||
      this.features.allSubjectsInFrame;
    const raiseSatisfied =
      interactionConfig.gestureMode.acceptRaiseArm &&
      raiseResult.satisfied &&
      framingSatisfied;
    const waveConfirmed = Boolean(
      initiatorWave?.confirmed && framingSatisfied,
    );
    const raiseStability = this.stabilityTracker.update(
      raiseSatisfied,
      this.zones.activePeople.length > 0,
      timestamp,
    );
    const confirmed = waveConfirmed || raiseStability.confirmed;
    const waveProgress = initiatorWave?.progress ?? 0;
    this.stability = {
      ...raiseStability,
      confirmed,
      progress: confirmed ? 1 : Math.max(raiseStability.progress, waveProgress),
    };
    const waveLeading = Boolean(
      initiatorWave &&
        (initiatorWave.crossings > 0 ||
          waveProgress >= raiseStability.progress),
    );
    this.gesture = {
      requiredPrimitive: waveLeading ? 'WAVE' : 'RAISE_ONE_ARM',
      satisfied: waveConfirmed || raiseSatisfied,
      matchScore: Math.max(raiseResult.matchScore, waveProgress),
      initiatorId: this.initiatorId,
      arm: waveLeading ? initiatorWave?.side ?? null : raiseResult.arm,
      wave: initiatorWave ?? undefined,
    };
    this.features = {
      ...this.features,
      poseReady: this.stability.confirmed,
    };
    if (this.stability.confirmed) {
      this.confirmedGesture = waveConfirmed ? 'wave' : 'raise';
      this.gestureConfirmedAt = performance.now();
      this.machine.dispatch('GESTURE_CONFIRMED');
    }
  }

  private updateSimpleSignals(timestamp: number) {
    const people = this.frame?.people ?? [];
    const currentState = this.simpleFlowSnapshot.state;
    this.simpleInput.personDetected =
      this.frameGateDiagnostics.sanityAcceptedCount > 0;
    if (currentState !== 'IDLE' && currentState !== 'PERCEIVING') return;
    const guidanceNeeded =
      this.zones.visiblePeople.length >
        interactionConfig.perception.maxActiveParticipants ||
      this.zones.visiblePeople.length > this.zones.capturePeople.length;
    const gestureStartsAt =
      simpleMode.iSeeYouMs +
      (guidanceNeeded ? simpleMode.positionGuidanceMs : 0);
    if (
      currentState === 'PERCEIVING' &&
      this.simpleFlowSnapshot.heldMs < gestureStartsAt
    ) {
      this.simpleInput = {
        ...this.simpleInput,
        handRaised: false,
        handSide: null,
        gestureConfirmed: false,
      };
      this.stabilityTracker.reset();
      this.handGestureService.reset();
      this.resetWaveTracking();
      return;
    }

    this.handGestureSnapshot = this.handGestureService.update(people, timestamp);
    this.updateWaveStates(timestamp, people);
    const raisedHand = immediateRaisedHand(people);
    const raiseResult = evaluateRaiseArm(
      people,
      null,
      simpleModeGesture.raiseArmScoreThreshold,
    );
    const raiseStability = this.stabilityTracker.update(
      raiseResult.satisfied,
      people.length > 0,
      timestamp,
    );
    const waveCandidate = [...this.waveStates.entries()]
      .filter(([, state]) => state.confirmed)
      .sort(
        (first, second) =>
          (first[1].lastCrossingAt ?? Number.POSITIVE_INFINITY) -
          (second[1].lastCrossingAt ?? Number.POSITIVE_INFINITY),
      )[0];
    const waveState = waveCandidate?.[1] ?? null;
    // The booth deliberately accepts any of its supported actions. The
    // on-screen prompt is guidance, not a restriction: a wave, raised arm,
    // victory sign or thumbs-up may start the same capture flow.
    const handGestureConfirmed = Boolean(this.handGestureSnapshot?.confirmed);
    const handGestureProgress = this.handGestureSnapshot?.category
      ? Math.min(
          1,
          this.handGestureSnapshot.stableCount /
            Math.max(1, this.handGestureSnapshot.stableTarget),
        )
      : 0;
    const gestureConfirmed = Boolean(
      raiseStability.confirmed ||
        waveState?.confirmed ||
        handGestureConfirmed,
    );
    const initiatorId =
      this.handGestureSnapshot?.crop?.personId ??
      waveCandidate?.[0] ??
      raiseResult.initiatorId ??
      raisedHand.personId;
    const arm = waveState?.side ?? raiseResult.arm ??
      this.handGestureSnapshot?.crop?.side ??
      (raisedHand.side === 'both' ? 'left' : raisedHand.side);

    this.initiatorId = initiatorId;
    this.wave = waveState;
    this.stability = {
      ...raiseStability,
      confirmed: gestureConfirmed,
      progress: gestureConfirmed
        ? 1
        : Math.max(
            raiseStability.progress,
            waveState?.progress ?? 0,
            handGestureProgress,
          ),
    };
    this.gesture = {
      requiredPrimitive: waveState ? 'WAVE' : 'RAISE_ONE_ARM',
      satisfied: gestureConfirmed || raisedHand.raised,
      matchScore: Math.max(
        raiseResult.matchScore,
        waveState?.progress ?? 0,
        raisedHand.raised ? 0.45 : 0,
      ),
      initiatorId,
      arm,
      wave: waveState ?? undefined,
    };
    this.features = {
      ...this.features,
      poseReady: gestureConfirmed,
    };
    this.simpleInput = {
      personDetected: this.simpleInput.personDetected,
      handRaised: raisedHand.raised,
      handSide: raisedHand.side,
      gestureConfirmed,
    };
  }

  private handleHandGesture = (snapshot: HandGestureSnapshot) => {
    this.handGestureSnapshot = snapshot;
    if (
      simpleMode.enabled &&
      snapshot.confirmed &&
      this.simpleFlowSnapshot.state === 'PERCEIVING'
    ) {
      this.simpleInput = {
        ...this.simpleInput,
        gestureConfirmed: true,
      };
      this.advanceSimpleFlow(performance.now());
    }
  };

  private updateWaveStates(
    timestamp: number,
    people = this.zones.activePeople,
  ) {
    if (!interactionConfig.gestureMode.acceptWave) {
      this.resetWaveTracking();
      return;
    }
    const activeIds = new Set(
      people.map((person) => person.id),
    );
    this.waveRules.forEach((_rule, personId) => {
      if (!activeIds.has(personId)) {
        this.waveRules.delete(personId);
        this.waveStates.delete(personId);
      }
    });
    people.forEach((person) => {
      let rule = this.waveRules.get(person.id);
      if (!rule) {
        rule = new WaveGestureRule({
          minCrossings: simpleMode.enabled
            ? simpleModeGesture.waveMinCrossings
            : effectiveInteractionConfig.waveMinCrossings,
          minAmplitude: simpleMode.enabled
            ? simpleModeGesture.waveMinAmplitude
            : effectiveInteractionConfig.waveMinAmplitude,
          wristAboveShoulderRatio: simpleMode.enabled
            ? simpleModeGesture.wristAboveShoulderRatio
            : interactionConfig.waveGesture.wristAboveShoulderRatio,
        });
        this.waveRules.set(person.id, rule);
      }
      this.waveStates.set(person.id, rule.update(person, timestamp));
    });
  }

  private validateLockedGroup(timestamp: number) {
    const valid =
      !this.zones.overflow &&
      this.zones.activeStable &&
      this.zones.activePeople.length > 0 &&
      this.lockedGroupMatches() &&
      (!effectiveInteractionConfig.requireInFrame ||
        this.features.allSubjectsInFrame);
    if (!valid && this.lockedPeopleAreBrieflyMissing(timestamp)) return;
    if (!valid) {
      this.cancelInteractionMemory();
      this.machine.dispatch('CAPTURE_INVALID');
    }
  }

  private advanceSimpleFlow(now: number) {
    if (!simpleMode.enabled) return;
    this.simpleFlowSnapshot = this.simpleFlow.update(now, this.simpleInput);
    this.countdown = this.simpleFlowSnapshot.countdown;
    this.emit();
  }

  private handleSimpleStateChange = (
    state: SimpleFlowState,
    previous: SimpleFlowState,
  ) => {
    if (!simpleMode.enabled) return;
    const now = performance.now();
    this.simpleFlowSnapshot = this.simpleFlow.getSnapshot(now);

    if (state === 'PERCEIVING') {
      this.lockedActiveIds = this.frame?.people.map((person) => person.id) ?? [];
      this.secondaryScores = scoreSecondaryDimensions(this.features);
      this.secondary = selectSecondaryDimension(this.secondaryScores).dimension;
    }

    if (state === 'LOCKED') {
      this.lockedActiveIds = this.frame?.people.map((person) => person.id) ??
        this.lockedActiveIds;
      this.gestureConfirmedAt = now;
      this.secondaryScores = scoreSecondaryDimensions(this.features);
      this.secondary = selectSecondaryDimension(this.secondaryScores).dimension;
    }

    if (state === 'IDLE' && previous !== 'IDLE') {
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
      this.handGestureService.reset();
      this.resetWaveTracking();
      this.bodyScaleSnapshot = null;
      this.features = EMPTY_FEATURES;
      this.zones = emptyZoneSnapshot();
      this.frame = null;
      this.simpleInput = {
        personDetected: false,
        handRaised: false,
        handSide: null,
        gestureConfirmed: false,
      };
    }
    this.emit();
  };

  private handleStateChange = (state: InteractionState) => {
    if (state !== 'DIRECT') {
      window.clearTimeout(this.gestureFallbackTimer);
      this.gestureFallbackTimer = 0;
    }
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
      this.resetWaveTracking();
      if (effectiveInteractionConfig.gestureFallbackMs !== null) {
        this.gestureFallbackTimer = window.setTimeout(() => {
          this.gestureFallbackTimer = 0;
          if (this.machine.getState() === 'DIRECT') {
            this.machine.dispatch('AUTO_COUNTDOWN');
          }
        }, effectiveInteractionConfig.gestureFallbackMs);
      }
    }
    if (state === 'POSE_READY') {
      this.readyTimer = window.setTimeout(() => {
        this.readyTimer = 0;
        if (
          this.machine.getState() === 'POSE_READY' &&
          this.lockedGroupMatches()
        ) {
          this.machine.dispatch('START_COUNTDOWN');
        }
      }, effectiveInteractionConfig.postGestureDelayMs ??
        (this.confirmedGesture === 'wave'
          ? interactionConfig.waveGesture.holdAfterConfirmMs
          : interactionConfig.readyHoldMs));
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
    this.resetWaveTracking();
  }

  private clearTimers() {
    window.clearTimeout(this.directTimer);
    window.clearTimeout(this.readyTimer);
    this.directTimer = 0;
    this.readyTimer = 0;
    window.clearTimeout(this.gestureFallbackTimer);
    this.gestureFallbackTimer = 0;
    window.clearInterval(this.simpleTickTimer);
    this.simpleTickTimer = 0;
    this.stopCountdown();
  }

  private lockedPeopleAreBrieflyMissing(timestamp: number) {
    if (!this.lockedActiveIds.length || !this.frame) {
      this.missingLockedSince = null;
      return false;
    }
    const visibleIds = new Set(
      interactionConfig.zoneBypass.enabled
        ? this.zones.activeIds
        : this.frame.people.map((person) => person.id),
    );
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
      (this.machine.getState() === 'COUNTDOWN'
        ? effectiveInteractionConfig.countdownGracePeriodMs
        : interactionConfig.trackingLossGraceMs)
    );
  }

  private lockedGroupMatches() {
    if (
      this.machine.getState() === 'COUNTDOWN' &&
      effectiveInteractionConfig.countdownAllowIdChange
    ) {
      return (
        this.zones.activeIds.length > 0 &&
        this.zones.activeIds.length === this.lockedActiveIds.length
      );
    }
    return sameIds(this.lockedActiveIds, this.zones.activeIds);
  }

  private currentBlocker(): InteractionBlocker | null {
    if (simpleMode.enabled) {
      if (this.simpleFlowSnapshot.state !== 'IDLE') return null;
      if (this.simpleFlowSnapshot.cooldownRemainingMs > 0) {
        return {
          condition: 'simpleModeCooldown',
          reason: `${Math.ceil(this.simpleFlowSnapshot.cooldownRemainingMs)}ms remaining`,
        };
      }
      if (!this.simpleFlowSnapshot.personPresent) {
        return {
          condition: 'personDetection',
          reason: 'waiting for any sanity-filtered pose',
        };
      }
      return null;
    }
    const state = this.machine.getState();
    if (
      state === 'COUNTDOWN' &&
      effectiveInteractionConfig.countdownSkipValidation
    ) {
      return null;
    }
    if (
      state === 'CAPTURE' ||
      state === 'CREATE' ||
      state === 'RESULT' ||
      state === 'ERROR'
    ) {
      return null;
    }
    if (!this.frame || this.perception.status !== 'running') {
      return {
        condition: 'perceptionRunning',
        reason: `perception status is ${this.perception.status}`,
      };
    }

    const diagnostics = this.frameGateDiagnostics;
    if (diagnostics.detectedCount === 0) {
      return {
        condition: 'personDetection',
        reason: 'no pose detected in the current frame',
      };
    }
    if (diagnostics.sanityAcceptedCount === 0) {
      const reasons = Object.entries(diagnostics.rejectReasons)
        .map(([reason, count]) => `${reason} ×${count}`)
        .join(', ');
      return {
        condition: 'sanityFilter',
        reason: reasons || 'all current poses rejected',
      };
    }
    if (diagnostics.confirmedCount === 0) {
      return {
        condition: 'trackConfirmation',
        reason: `${diagnostics.confirmationProgressFrames}/${diagnostics.requiredConfirmationFrames} frames`,
      };
    }
    if (this.zones.overflow) {
      return {
        condition: 'participantLimit',
        reason: `${this.zones.capturePeople.length} people detected; maximum is ${interactionConfig.perception.maxActiveParticipants}`,
      };
    }
    if (this.zones.capturePeople.length === 0) {
      return interactionConfig.zoneBypass.enabled
        ? {
            condition: 'minPersonScaleRatio',
            reason: `torso scale is below ${effectiveInteractionConfig.minPersonScaleRatio.toFixed(2)}`,
          }
        : {
            condition: 'captureZone',
            reason: 'no confirmed person is in the capture zone',
          };
    }
    if (this.zones.activePeople.length === 0) {
      return {
        condition: 'activeGroup',
        reason: 'no valid 1–5 person active group',
      };
    }
    if (!this.zones.activeStable) {
      return {
        condition: 'activeGroupStable',
        reason: `waiting ${effectiveInteractionConfig.activeGroupStableMs}ms for a stable group`,
      };
    }
    if (
      effectiveInteractionConfig.requireInFrame &&
      !this.features.allSubjectsInFrame
    ) {
      const failed = this.zones.activePeople
        .map((person) =>
          subjectInFrameResult(
            person,
            effectiveInteractionConfig.inFrameRequiredKeypoints,
          ),
        )
        .find((result) => !result.pass);
      return {
        condition: 'allSubjectsInFrame',
        reason: failed?.reason ?? 'required keypoints are not in frame',
      };
    }
    if (
      state === 'PASSERBY' ||
      state === 'ENGAGED' ||
      state === 'CAPTURE_ZONE'
    ) {
      return {
        condition: 'preGestureDelay',
        reason: `waiting ${effectiveInteractionConfig.preGestureDelayMs}ms before gesture input`,
      };
    }
    if (state === 'DIRECT') {
      if (!this.initiatorId) {
        return {
          condition: 'gestureInitiator',
          reason: 'raise an arm or complete the first wave crossing',
        };
      }
      if (!this.stability.confirmed) {
        if (this.gesture?.requiredPrimitive === 'WAVE') {
          return {
            condition: 'waveGesture',
            reason: `crossings ${this.wave?.crossings ?? 0}/${effectiveInteractionConfig.waveMinCrossings}, amplitude ${(this.wave?.amplitude ?? 0).toFixed(2)}/${effectiveInteractionConfig.waveMinAmplitude.toFixed(2)}`,
          };
        }
        return {
          condition: 'raiseArmGesture',
          reason: `score ${(this.gesture?.matchScore ?? 0).toFixed(2)}/${effectiveInteractionConfig.raiseArmScoreThreshold.toFixed(2)}, hold ${Math.round(this.stability.progress * 100)}%`,
        };
      }
    }
    if (state === 'POSE_READY') {
      return {
        condition: 'postGestureDelay',
        reason: `waiting ${effectiveInteractionConfig.postGestureDelayMs ?? interactionConfig.readyHoldMs}ms before countdown`,
      };
    }
    if (state === 'COUNTDOWN' && !this.lockedGroupMatches()) {
      return {
        condition: 'countdownGroup',
        reason: effectiveInteractionConfig.countdownAllowIdChange
          ? 'participant count changed during countdown'
          : 'participant tracking IDs changed during countdown',
      };
    }
    return null;
  }

  private emit() {
    this.listener(this.getSnapshot());
  }

  private resetWaveTracking() {
    this.waveRules.forEach((rule) => rule.reset());
    this.waveRules.clear();
    this.waveStates.clear();
    this.wave = null;
    this.initiatorGesture = null;
    this.initiatorWaveLastCrossingAt = null;
    this.confirmedGesture = null;
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
      readings: annotated.readings.map((reading) => {
        const wave = this.waveStates.get(reading.stableTrackId);
        return {
          ...reading,
          waveActive: wave?.active ?? false,
          waveCrossings: wave?.crossings ?? 0,
          waveAmplitude: wave?.amplitude ?? 0,
          waveProgress: wave?.progress ?? 0,
          waveConfirmed: wave?.confirmed ?? false,
          waveSide: wave?.side ?? null,
          fps: frame.fps,
          inferenceMs: frame.inferenceMs,
          captureMs: frame.timing?.captureMs ?? 0,
          inferMs: frame.timing?.inferMs ?? frame.inferenceMs,
          postMs: frame.timing?.postMs ?? 0,
          renderMs: frame.timing?.renderMs ?? 0,
          totalMs: frame.timing?.totalMs ?? frame.inferenceMs,
        };
      }),
    };
  }
}
