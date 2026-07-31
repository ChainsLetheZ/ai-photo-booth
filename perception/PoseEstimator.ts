import type { PerceptionEngine, PersonObservation } from './types';

export interface PoseEstimator {
  readonly engine: PerceptionEngine;
  detect(
    video: HTMLVideoElement,
    timestamp: number,
  ): PersonObservation[] | Promise<PersonObservation[]>;
  close(): void;
}

