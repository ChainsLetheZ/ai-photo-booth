import { interactionConfig } from '../config/interactionConfig';
import type {
  PerceptionFrame,
  PersonObservation,
} from '../perception/types';

export type InteractionZone = 'PASSERBY' | 'ENGAGED' | 'CAPTURE_ZONE';

export interface PersonZoneReading {
  personId: string;
  rawZone: InteractionZone;
  stableZone: InteractionZone;
  stableForMs: number;
}

export interface ZoneSnapshot {
  visiblePeople: PersonObservation[];
  engagedPeople: PersonObservation[];
  capturePeople: PersonObservation[];
  activePeople: PersonObservation[];
  activeIds: string[];
  readings: PersonZoneReading[];
  overflow: boolean;
  activeStable: boolean;
}

interface TrackZoneState {
  stableZone: InteractionZone;
  candidateZone: InteractionZone;
  candidateSince: number;
  stableSince: number;
  lastSeenAt: number;
}

const EMPTY: ZoneSnapshot = {
  visiblePeople: [],
  engagedPeople: [],
  capturePeople: [],
  activePeople: [],
  activeIds: [],
  readings: [],
  overflow: false,
  activeStable: false,
};

export function emptyZoneSnapshot(): ZoneSnapshot {
  return { ...EMPTY };
}

function orderedSignature(ids: string[]) {
  return [...ids].sort().join('|');
}

export class ZoneTracker {
  private readonly tracks = new Map<string, TrackZoneState>();
  private activeSignature = '';
  private activeSignatureSince = 0;

  update(frame: PerceptionFrame): ZoneSnapshot {
    const { timestamp, people } = frame;
    const readings = people.map((person) => {
      let track = this.tracks.get(person.id);
      if (!track) {
        const initialCandidate = this.rawZone(person, 'PASSERBY');
        track = {
          stableZone: 'PASSERBY',
          candidateZone: initialCandidate,
          candidateSince: timestamp,
          stableSince: timestamp,
          lastSeenAt: timestamp,
        };
        this.tracks.set(person.id, track);
      }

      const rawZone = this.rawZone(person, track.stableZone);
      track.lastSeenAt = timestamp;
      if (rawZone !== track.candidateZone) {
        track.candidateZone = rawZone;
        track.candidateSince = timestamp;
      } else if (
        rawZone !== track.stableZone &&
        timestamp - track.candidateSince >=
          interactionConfig.zones.stableDwellMs
      ) {
        track.stableZone = rawZone;
        track.stableSince = timestamp;
      }
      return {
        personId: person.id,
        rawZone,
        stableZone: track.stableZone,
        stableForMs: timestamp - track.stableSince,
      };
    });

    const visibleIds = new Set(people.map((person) => person.id));
    this.tracks.forEach((track, id) => {
      if (
        !visibleIds.has(id) &&
        timestamp - track.lastSeenAt >
          interactionConfig.zones.trackRetentionMs
      ) {
        this.tracks.delete(id);
      }
    });

    const readingById = new Map(
      readings.map((reading) => [reading.personId, reading]),
    );
    const engagedPeople = people.filter((person) => {
      const zone = readingById.get(person.id)?.stableZone;
      return zone === 'ENGAGED' || zone === 'CAPTURE_ZONE';
    });
    const capturePeople = people.filter(
      (person) =>
        readingById.get(person.id)?.stableZone === 'CAPTURE_ZONE',
    );
    const overflow =
      capturePeople.length > interactionConfig.perception.maxActiveParticipants;
    const activePeople = overflow ? [] : capturePeople;
    const activeIds = activePeople.map((person) => person.id);
    const signature = orderedSignature(activeIds);
    if (signature !== this.activeSignature) {
      this.activeSignature = signature;
      this.activeSignatureSince = timestamp;
    }
    const activeStable =
      activeIds.length > 0 &&
      !overflow &&
      timestamp - this.activeSignatureSince >=
        interactionConfig.zones.activeGroupSettleMs;

    return {
      visiblePeople: people,
      engagedPeople,
      capturePeople,
      activePeople,
      activeIds,
      readings,
      overflow,
      activeStable,
    };
  }

  reset() {
    this.tracks.clear();
    this.activeSignature = '';
    this.activeSignatureSince = 0;
  }

  private rawZone(
    person: PersonObservation,
    stableZone: InteractionZone,
  ): InteractionZone {
    const { x, y } = person.footPoint;
    const {
      horizontalMargin,
      captureEnterY,
      captureExitY,
      engagedEnterY,
      engagedExitY,
    } = interactionConfig.zones;
    if (x < horizontalMargin || x > 1 - horizontalMargin) return 'PASSERBY';

    if (stableZone === 'CAPTURE_ZONE') {
      if (y >= captureExitY) return 'CAPTURE_ZONE';
      return y >= engagedExitY ? 'ENGAGED' : 'PASSERBY';
    }
    if (stableZone === 'ENGAGED') {
      if (y >= captureEnterY) return 'CAPTURE_ZONE';
      return y >= engagedExitY ? 'ENGAGED' : 'PASSERBY';
    }
    if (y >= captureEnterY) return 'CAPTURE_ZONE';
    if (y >= engagedEnterY) return 'ENGAGED';
    return 'PASSERBY';
  }
}

