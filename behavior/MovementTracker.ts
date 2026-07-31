import { interactionConfig } from '../config/interactionConfig';
import type { PerceptionFrame, PersonObservation } from '../perception/types';

const MAJOR_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24];

interface PersonMotion {
  centerX: number;
  centerY: number;
  landmarks: Array<{ x: number; y: number }>;
  timestamp: number;
}

interface MotionSample {
  timestamp: number;
  intensity: number;
  synchrony?: number;
  centers: Array<{ x: number; y: number }>;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function landmarkMotion(
  person: PersonObservation,
  previous: PersonMotion,
  deltaSeconds: number,
) {
  const distances = MAJOR_LANDMARKS.map((index, sampleIndex) => {
    const current = person.poseLandmarks[index];
    const before = previous.landmarks[sampleIndex];
    if (!current || !before) return 0;
    return Math.hypot(current.x - before.x, current.y - before.y);
  });
  return average(distances) / Math.max(deltaSeconds, 0.001);
}

export class MovementTracker {
  private previousPeople = new Map<string, PersonMotion>();
  private samples: MotionSample[] = [];

  update(frame: PerceptionFrame) {
    const velocities: Array<{ x: number; y: number }> = [];
    const personIntensities: number[] = [];

    frame.people.forEach((person) => {
      const previous = this.previousPeople.get(person.id);
      if (previous) {
        const deltaSeconds = (frame.timestamp - previous.timestamp) / 1000;
        personIntensities.push(landmarkMotion(person, previous, deltaSeconds));
        velocities.push({
          x: (person.centerX - previous.centerX) / Math.max(deltaSeconds, 0.001),
          y: (person.centerY - previous.centerY) / Math.max(deltaSeconds, 0.001),
        });
      }
      this.previousPeople.set(person.id, {
        centerX: person.centerX,
        centerY: person.centerY,
        timestamp: frame.timestamp,
        landmarks: MAJOR_LANDMARKS.map((index) => ({
          x: person.poseLandmarks[index]?.x ?? person.centerX,
          y: person.poseLandmarks[index]?.y ?? person.centerY,
        })),
      });
    });

    const currentIds = new Set(frame.people.map((person) => person.id));
    [...this.previousPeople.keys()].forEach((id) => {
      if (!currentIds.has(id)) this.previousPeople.delete(id);
    });

    const rawIntensity =
      average(personIntensities) / interactionConfig.movementVelocityScale;
    const synchrony = this.calculateSynchrony(velocities);
    this.samples.push({
      timestamp: frame.timestamp,
      intensity: clamp01(rawIntensity),
      synchrony,
      centers: frame.people.map((person) => ({
        x: person.centerX,
        y: person.centerY,
      })),
    });
    this.samples = this.samples.filter(
      (sample) =>
        frame.timestamp - sample.timestamp <= interactionConfig.featureHistoryMs,
    );

    const motionWindow = this.samples.filter(
      (sample) =>
        frame.timestamp - sample.timestamp <= interactionConfig.movementWindowMs,
    );
    const movementIntensity = average(
      motionWindow.map((sample) => sample.intensity),
    );
    const synchronySamples = motionWindow
      .map((sample) => sample.synchrony)
      .filter((value): value is number => value !== undefined);

    return {
      movementIntensity,
      movementSynchrony:
        synchronySamples.length > 0 ? average(synchronySamples) : undefined,
      spatialExploration: this.calculateExploration(),
      stability: clamp01(1 - movementIntensity * 1.4),
    };
  }

  reset() {
    this.previousPeople.clear();
    this.samples = [];
  }

  private calculateSynchrony(velocities: Array<{ x: number; y: number }>) {
    if (velocities.length < 2) return undefined;
    const scores: number[] = [];
    for (let first = 0; first < velocities.length - 1; first += 1) {
      for (let second = first + 1; second < velocities.length; second += 1) {
        const a = velocities[first];
        const b = velocities[second];
        const magnitudeA = Math.hypot(a.x, a.y);
        const magnitudeB = Math.hypot(b.x, b.y);
        if (magnitudeA < 0.01 || magnitudeB < 0.01) continue;
        const cosine = (a.x * b.x + a.y * b.y) / (magnitudeA * magnitudeB);
        scores.push(clamp01((cosine + 1) / 2));
      }
    }
    return scores.length ? average(scores) : undefined;
  }

  private calculateExploration() {
    const centers = this.samples.flatMap((sample) => sample.centers);
    if (centers.length < 3) return 0;
    const xs = centers.map((center) => center.x);
    const ys = centers.map((center) => center.y);
    const range = Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    return clamp01(range / 0.42);
  }
}
