export interface BehaviorFeatures {
  personCount: number;
  armsOpen: boolean;
  handsConverged: boolean;
  handsTowardCenter: boolean;
  peopleClose: boolean;
  groupCohesion: number;
  movementIntensity: number;
  movementSynchrony?: number;
  spatialExploration: number;
  stability: number;
  poseReady: boolean;
  allSubjectsInFrame: boolean;
  detectionStable: boolean;
}
