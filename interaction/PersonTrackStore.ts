import {
  bodyScaleProbe,
  interactionConfig,
} from '../config/interactionConfig';
import {
  bodyScale,
  MedianWindow,
  OneEuroFilter,
  type BodyScaleResult,
  type Pt,
} from '../perception/BodyScaleProbe';
import {
  keypointConfidence,
  poseSanityFilter,
  type SanityRejectReason,
} from '../perception/PoseSanityFilter';
import type {
  Landmark,
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';
import type { InteractionZone, ZoneSnapshot } from './ZoneTracker';
import {
  BodyScaleZoneDecision,
  type BodyScaleDecisionZone,
} from './BodyScaleZoneDecision';

export type ExistingZone = 'Z0' | 'Z1' | 'Z2';
export type PostureReason = 'ok' | 'bent' | 'occluded' | 'unknown';

export interface TrackScaleState {
  rawScale: number | null;
  medScale: number | null;
  filtScale: number | null;
  baseline: number | null;
  g: number | null;
  baselineFrozen: boolean;
  nullFrameCount: number;
  totalFrameCount: number;
  median: MedianWindow;
  euro: OneEuroFilter;
  zoneDecision: BodyScaleZoneDecision;
}

export interface SanityWindowSnapshot {
  acceptedCount: number;
  rejectedCount: number;
  rejectReasons: Partial<Record<SanityRejectReason, number>>;
  unconfirmedCount: number;
}

export interface TrackScaleReading {
  timestampMs: number;
  trackId: string;
  stableTrackId: string;
  rawScale: number | null;
  medScale: number | null;
  filtScale: number | null;
  baseline: number | null;
  g: number | null;
  baselineFrozen: boolean;
  nullFrameCount: number;
  totalFrameCount: number;
  torso: number | null;
  shoulderWidth: number | null;
  confLs: number | null;
  confRs: number | null;
  confLh: number | null;
  confRh: number | null;
  scaleNull: boolean;
  nullReason: '' | 'low_confidence' | 'missing_keypoint';
  postureValid: boolean;
  postureReason: PostureReason;
  decisionZone: BodyScaleDecisionZone;
  credit: number;
  gVelocity: number | null;
  baselineInitCount: number;
  postureInvalidForMs: number;
  zoneProxy: 'bodyScale' | 'footY';
  footYNorm: number;
  existingZone: ExistingZone;
  activeCount: number;
  fps: number;
  inferenceMs: number;
  captureMs: number;
  inferMs: number;
  postMs: number;
  renderMs: number;
  totalMs: number;
  rejectedCount: number;
  rejectReasons: Partial<Record<SanityRejectReason, number>>;
}

export interface BodyScaleProbeSnapshot {
  readings: TrackScaleReading[];
  sanity: SanityWindowSnapshot;
  directionComparisons: number;
  directionMismatches: number;
}

export interface StabilizedFrameResult {
  frame: PerceptionFrame;
  sanity: SanityWindowSnapshot;
}

interface InternalTrack {
  stableTrackId: string;
  rawTrackId: string;
  confirmed: boolean;
  confirmFrames: number;
  state: TrackScaleState;
  lastSeenAt: number;
  lastCenterX: number;
  lastCenterY: number;
  lastRawScale: number | null;
  torsoAspectHistory: number[];
}

interface SanityEvent {
  timestamp: number;
  accepted: boolean;
  reason?: SanityRejectReason;
}

const SANITY_WINDOW_MS = 10_000;
const POSTURE_HISTORY_SIZE = 90;

export function existingZoneLabel(zone: InteractionZone): ExistingZone {
  if (zone === 'CAPTURE_ZONE') return 'Z2';
  if (zone === 'ENGAGED') return 'Z1';
  return 'Z0';
}

export function createTrackScaleState(): TrackScaleState {
  return {
    rawScale: null,
    medScale: null,
    filtScale: null,
    baseline: null,
    g: null,
    baselineFrozen: false,
    nullFrameCount: 0,
    totalFrameCount: 0,
    median: new MedianWindow(bodyScaleProbe.medianWindowSize),
    euro: new OneEuroFilter(
      bodyScaleProbe.oneEuro.minCutoff,
      bodyScaleProbe.oneEuro.beta,
      bodyScaleProbe.oneEuro.dCutoff,
    ),
    zoneDecision: new BodyScaleZoneDecision(),
  };
}

export function updateScaleBaseline(
  state: TrackScaleState,
  filtScale: number,
  existingZone: ExistingZone,
  followRate: number = bodyScaleProbe.baselineFollowRate,
) {
  if (state.baseline === null) {
    state.baseline = filtScale;
  } else if (existingZone !== 'Z2') {
    state.baseline += (filtScale - state.baseline) * followRate;
    state.baselineFrozen = false;
  } else {
    state.baselineFrozen = true;
  }
  state.g = state.baseline > 0 ? filtScale / state.baseline : null;
}

function pixelPoint(
  landmark: Landmark | undefined,
  width: number,
  height: number,
): Pt | undefined {
  if (!landmark) return undefined;
  return {
    x: landmark.x * width,
    y: landmark.y * height,
    score: keypointConfidence(landmark) ?? undefined,
  };
}

function pixelKeypoints(
  person: PersonObservation,
  width: number,
  height: number,
) {
  return {
    leftShoulder: pixelPoint(person.keypoints.leftShoulder, width, height),
    rightShoulder: pixelPoint(person.keypoints.rightShoulder, width, height),
    leftHip: pixelPoint(person.keypoints.leftHip, width, height),
    rightHip: pixelPoint(person.keypoints.rightHip, width, height),
  };
}

function rawBodyScale(
  person: PersonObservation,
  width: number,
  height: number,
) {
  return bodyScale(
    pixelKeypoints(person, width, height),
    interactionConfig.perception.minKeypointConfidence,
    bodyScaleProbe.shoulderWidthFactor,
  );
}

function relativeScaleDifference(first: number | null, second: number | null) {
  if (first === null || second === null || first <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(second - first) / first;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

function postureReading(
  track: InternalTrack,
  person: PersonObservation,
  result: BodyScaleResult,
): { postureValid: boolean; postureReason: PostureReason } {
  const shoulderConfidence = Math.min(
    keypointConfidence(person.keypoints.leftShoulder) ?? 0,
    keypointConfidence(person.keypoints.rightShoulder) ?? 0,
  );
  const hipConfidence = Math.min(
    keypointConfidence(person.keypoints.leftHip) ?? 0,
    keypointConfidence(person.keypoints.rightHip) ?? 0,
  );
  if (
    shoulderConfidence >= interactionConfig.perception.minKeypointConfidence &&
    hipConfidence < interactionConfig.perception.minKeypointConfidence
  ) {
    return { postureValid: false, postureReason: 'occluded' };
  }
  const leftShoulder = person.keypoints.leftShoulder;
  const rightShoulder = person.keypoints.rightShoulder;
  const leftHip = person.keypoints.leftHip;
  const rightHip = person.keypoints.rightHip;
  if (
    result.scale === null ||
    result.torso === null ||
    result.shoulderWidth === null ||
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip
  ) {
    return { postureValid: false, postureReason: 'unknown' };
  }

  const shoulderMid = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const hipMid = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
  };
  const tiltDeg =
    (Math.atan2(
      Math.abs(shoulderMid.x - hipMid.x),
      Math.abs(shoulderMid.y - hipMid.y),
    ) *
      180) /
    Math.PI;
  const torsoAspect =
    result.torso / Math.max(result.shoulderWidth, Number.EPSILON);
  const historicalMedian = median(track.torsoAspectHistory);
  const aspectCollapsed =
    historicalMedian !== null &&
    track.torsoAspectHistory.length >=
      interactionConfig.tracking.trackConfirmFrames &&
    torsoAspect <
      historicalMedian * interactionConfig.posture.minTorsoRatioOfMedian;
  if (
    tiltDeg > interactionConfig.posture.maxTorsoTiltDeg ||
    aspectCollapsed
  ) {
    return { postureValid: false, postureReason: 'bent' };
  }
  track.torsoAspectHistory.push(torsoAspect);
  if (track.torsoAspectHistory.length > POSTURE_HISTORY_SIZE) {
    track.torsoAspectHistory.shift();
  }
  return { postureValid: true, postureReason: 'ok' };
}

export class PersonTrackStore {
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly rawToStable = new Map<string, string>();
  private readonly sanityEvents: SanityEvent[] = [];
  private nextStableTrackId = 1;
  private latestSanity: SanityWindowSnapshot = {
    acceptedCount: 0,
    rejectedCount: 0,
    rejectReasons: {},
    unconfirmedCount: 0,
  };

  stabilize(
    frame: PerceptionFrame,
    sourceWidth: number,
    sourceHeight: number,
  ): StabilizedFrameResult {
    const width = Math.max(1, sourceWidth);
    const height = Math.max(1, sourceHeight);
    this.expireTracks(frame.timestamp);
    const matchedStableIds = new Set<string>();
    const confirmedPeople: PersonObservation[] = [];

    frame.people.forEach((person) => {
      const sanityResult = poseSanityFilter(person, width, height);
      this.sanityEvents.push({
        timestamp: frame.timestamp,
        accepted: sanityResult.pass,
        reason: sanityResult.rejectReason,
      });
      if (!sanityResult.pass) return;

      const rawTrackId = person.rawTrackId ?? person.id;
      const scaleResult = rawBodyScale(person, width, height);
      let track = this.trackForRawId(rawTrackId, matchedStableIds);
      if (!track) {
        track = this.findReassociation(
          person,
          scaleResult.scale,
          frame.timestamp,
          matchedStableIds,
        );
        if (track) {
          this.rawToStable.delete(track.rawTrackId);
          track.rawTrackId = rawTrackId;
          this.rawToStable.set(rawTrackId, track.stableTrackId);
        }
      }
      if (!track) {
        track = this.createTrack(rawTrackId, person, scaleResult.scale, frame.timestamp);
      } else {
        track.confirmFrames += 1;
      }

      track.lastSeenAt = frame.timestamp;
      track.lastCenterX = person.centerX;
      track.lastCenterY = person.centerY;
      track.lastRawScale = scaleResult.scale;
      if (
        !track.confirmed &&
        track.confirmFrames >= interactionConfig.tracking.trackConfirmFrames
      ) {
        track.confirmed = true;
      }
      matchedStableIds.add(track.stableTrackId);
      if (track.confirmed) {
        confirmedPeople.push({
          ...person,
          id: track.stableTrackId,
          rawTrackId,
          stableTrackId: track.stableTrackId,
        });
      }
    });

    this.removeInterruptedCandidates(matchedStableIds);
    this.updateSanitySnapshot(frame.timestamp);
    return {
      frame: { ...frame, people: confirmedPeople },
      sanity: this.latestSanity,
    };
  }

  measure(
    frame: PerceptionFrame,
    zones: ZoneSnapshot,
    sourceWidth: number,
    sourceHeight: number,
  ): BodyScaleProbeSnapshot {
    const width = Math.max(1, sourceWidth);
    const height = Math.max(1, sourceHeight);
    const readings = frame.people.flatMap((person) => {
      const stableTrackId = person.stableTrackId ?? person.id;
      const track = this.tracks.get(stableTrackId);
      if (!track?.confirmed) return [];
      const state = track.state;
      state.totalFrameCount += 1;
      const result = rawBodyScale(person, width, height);
      state.rawScale = result.scale;
      if (result.scale === null) {
        state.nullFrameCount += 1;
        state.medScale = null;
        state.filtScale = null;
      } else {
        state.medScale = state.median.push(result.scale);
        state.filtScale = state.euro.filter(state.medScale, frame.timestamp);
      }
      const posture = postureReading(track, person, result);
      const decision = state.zoneDecision.update({
        timestampMs: frame.timestamp,
        filtScale: state.filtScale,
        postureValid: posture.postureValid,
      });
      state.baseline = decision.baseline;
      state.g = decision.g;
      state.baselineFrozen = decision.baselineFrozen;
      const decisionZone: ExistingZone = decision.zone;

      return [{
        timestampMs: frame.timestamp,
        trackId: person.rawTrackId ?? track.rawTrackId,
        stableTrackId,
        rawScale: state.rawScale,
        medScale: state.medScale,
        filtScale: state.filtScale,
        baseline: state.baseline,
        g: state.g,
        baselineFrozen: state.baselineFrozen,
        nullFrameCount: state.nullFrameCount,
        totalFrameCount: state.totalFrameCount,
        torso: result.torso,
        shoulderWidth: result.shoulderWidth,
        confLs: keypointConfidence(person.keypoints.leftShoulder),
        confRs: keypointConfidence(person.keypoints.rightShoulder),
        confLh: keypointConfidence(person.keypoints.leftHip),
        confRh: keypointConfidence(person.keypoints.rightHip),
        scaleNull: result.scale === null,
        nullReason: result.reason === 'ok' ? '' : result.reason,
        postureValid: posture.postureValid,
        postureReason: posture.postureReason,
        decisionZone: decision.zone,
        credit: decision.credit,
        gVelocity: decision.gVelocity,
        baselineInitCount: decision.baselineInitCount,
        postureInvalidForMs: decision.postureInvalidForMs,
        zoneProxy: interactionConfig.zoneProxy,
        footYNorm: person.footPoint.y,
        existingZone: decisionZone,
        activeCount: zones.activePeople.length,
        fps: frame.fps,
        inferenceMs: frame.inferenceMs,
        captureMs: frame.timing?.captureMs ?? 0,
        inferMs: frame.timing?.inferMs ?? frame.inferenceMs,
        postMs: frame.timing?.postMs ?? 0,
        renderMs: frame.timing?.renderMs ?? 0,
        totalMs: frame.timing?.totalMs ?? frame.inferenceMs,
        rejectedCount: this.latestSanity.rejectedCount,
        rejectReasons: this.latestSanity.rejectReasons,
      } satisfies TrackScaleReading];
    });

    let directionComparisons = 0;
    let directionMismatches = 0;
    for (let first = 0; first < readings.length; first += 1) {
      for (let second = first + 1; second < readings.length; second += 1) {
        const firstScale = readings[first].rawScale;
        const secondScale = readings[second].rawScale;
        if (firstScale === null || secondScale === null || firstScale === secondScale) {
          continue;
        }
        directionComparisons += 1;
        const scaleDelta = firstScale - secondScale;
        const footDelta = readings[first].footYNorm - readings[second].footYNorm;
        if (scaleDelta * footDelta < 0) directionMismatches += 1;
      }
    }

    return {
      readings,
      sanity: this.latestSanity,
      directionComparisons,
      directionMismatches,
    };
  }

  reset() {
    this.tracks.forEach((track) => this.disposeTrack(track));
    this.tracks.clear();
    this.rawToStable.clear();
    this.sanityEvents.length = 0;
    this.nextStableTrackId = 1;
    this.latestSanity = {
      acceptedCount: 0,
      rejectedCount: 0,
      rejectReasons: {},
      unconfirmedCount: 0,
    };
  }

  annotateZones(
    snapshot: BodyScaleProbeSnapshot,
    zones: ZoneSnapshot,
  ): BodyScaleProbeSnapshot {
    const zoneById = new Map(
      zones.readings.map((reading) => [reading.personId, reading.stableZone]),
    );
    const proxyById = new Map(
      zones.readings.map((reading) => [reading.personId, reading.proxy]),
    );
    return {
      ...snapshot,
      readings: snapshot.readings.map((reading) => ({
        ...reading,
        existingZone: existingZoneLabel(
          zoneById.get(reading.stableTrackId) ?? 'PASSERBY',
        ),
        zoneProxy: proxyById.get(reading.stableTrackId) ?? reading.zoneProxy,
        activeCount: zones.activePeople.length,
      })),
    };
  }

  private createTrack(
    rawTrackId: string,
    person: PersonObservation,
    rawScale: number | null,
    timestamp: number,
  ) {
    const stableTrackId = `stable-${this.nextStableTrackId++}`;
    const track: InternalTrack = {
      stableTrackId,
      rawTrackId,
      confirmed: false,
      confirmFrames: 1,
      state: createTrackScaleState(),
      lastSeenAt: timestamp,
      lastCenterX: person.centerX,
      lastCenterY: person.centerY,
      lastRawScale: rawScale,
      torsoAspectHistory: [],
    };
    this.tracks.set(stableTrackId, track);
    this.rawToStable.set(rawTrackId, stableTrackId);
    return track;
  }

  private trackForRawId(rawTrackId: string, matched: Set<string>) {
    const stableTrackId = this.rawToStable.get(rawTrackId);
    if (!stableTrackId || matched.has(stableTrackId)) return undefined;
    return this.tracks.get(stableTrackId);
  }

  private findReassociation(
    person: PersonObservation,
    rawScale: number | null,
    timestamp: number,
    matched: Set<string>,
  ) {
    let best: InternalTrack | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.tracks.forEach((track) => {
      if (
        !track.confirmed ||
        matched.has(track.stableTrackId) ||
        timestamp - track.lastSeenAt >
          interactionConfig.tracking.stableTrackGracePeriodMs
      ) {
        return;
      }
      const distance = Math.hypot(
        person.centerX - track.lastCenterX,
        person.centerY - track.lastCenterY,
      );
      if (
        distance >= interactionConfig.tracking.stableTrackReassociateRadius ||
        relativeScaleDifference(track.lastRawScale, rawScale) >=
          interactionConfig.tracking.maxReassociateScaleDifference ||
        distance >= bestDistance
      ) {
        return;
      }
      best = track;
      bestDistance = distance;
    });
    return best;
  }

  private expireTracks(timestamp: number) {
    this.tracks.forEach((track) => {
      if (
        track.confirmed &&
        timestamp - track.lastSeenAt >
          interactionConfig.tracking.stableTrackGracePeriodMs
      ) {
        this.deleteTrack(track);
      }
    });
  }

  private removeInterruptedCandidates(matched: Set<string>) {
    this.tracks.forEach((track) => {
      if (!track.confirmed && !matched.has(track.stableTrackId)) {
        this.deleteTrack(track);
      }
    });
  }

  private deleteTrack(track: InternalTrack) {
    this.disposeTrack(track);
    this.tracks.delete(track.stableTrackId);
    this.rawToStable.delete(track.rawTrackId);
  }

  private disposeTrack(track: InternalTrack) {
    track.state.median.reset();
    track.state.euro.reset();
    track.state.zoneDecision.reset();
  }

  private updateSanitySnapshot(timestamp: number) {
    while (
      this.sanityEvents.length &&
      timestamp - this.sanityEvents[0].timestamp > SANITY_WINDOW_MS
    ) {
      this.sanityEvents.shift();
    }
    const rejectReasons: Partial<Record<SanityRejectReason, number>> = {};
    let acceptedCount = 0;
    let rejectedCount = 0;
    this.sanityEvents.forEach((event) => {
      if (event.accepted) {
        acceptedCount += 1;
      } else {
        rejectedCount += 1;
        if (event.reason) {
          rejectReasons[event.reason] = (rejectReasons[event.reason] ?? 0) + 1;
        }
      }
    });
    this.latestSanity = {
      acceptedCount,
      rejectedCount,
      rejectReasons,
      unconfirmedCount: [...this.tracks.values()].filter(
        (track) => !track.confirmed,
      ).length,
    };
  }
}
