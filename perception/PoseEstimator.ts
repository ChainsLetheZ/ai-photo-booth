import type {
  DetectionTiming,
  PerceptionDiagnostics,
  PerceptionEngine,
  PersonObservation,
} from './types';

export interface PoseEstimator {
  readonly engine: PerceptionEngine;
  detect(
    video: HTMLVideoElement,
    timestamp: number,
  ): PersonObservation[] | Promise<PersonObservation[]>;
  getLastTiming?(): DetectionTiming;
  getDiagnostics?(): PerceptionDiagnostics;
  close(): void;
}
