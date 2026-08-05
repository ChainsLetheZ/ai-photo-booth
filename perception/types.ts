export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
  coordinateTrace?: {
    roi: { x: number; y: number };
    video: { x: number; y: number };
  };
}

export type BodyJoint =
  | 'nose'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle';

export type BodyKeypoints = Partial<Record<BodyJoint, Landmark>>;

export interface NormalizedBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
}

export type PerceptionEngine = 'movenet' | 'mediapipe';

export interface FrameTiming {
  captureMs: number;
  inferMs: number;
  postMs: number;
  renderMs: number;
  totalMs: number;
}

export type DetectionTiming = Pick<
  FrameTiming,
  'captureMs' | 'inferMs' | 'postMs'
>;

export interface PersonObservation {
  id: string;
  rawTrackId?: string;
  stableTrackId?: string;
  source: PerceptionEngine;
  poseScore?: number;
  poseLandmarks: Landmark[];
  keypoints: BodyKeypoints;
  bounds: NormalizedBounds;
  footPoint: { x: number; y: number };
  centerX: number;
  centerY: number;
  visibleConfidence: number;
}

export interface PerceptionDiagnostics {
  backend: string;
  numTensors: number | null;
  roiInputWidth: number;
  roiInputHeight: number;
  maxPoses: number;
  modelType?: string;
  webglFlags?: Record<string, boolean | number | string | null>;
  /** Poses the model returned, before the minPoseScore gate. */
  rawPoseCount?: number;
  /** Best pose score the model produced, before the gate. */
  topPoseScore?: number | null;
  minPoseScore?: number;
}

export interface HandObservation {
  id: string;
  handedness?: 'left' | 'right';
  landmarks: Landmark[];
  centerX: number;
  centerY: number;
  confidence: number;
}

export interface PerceptionFrame {
  timestamp: number;
  people: PersonObservation[];
  hands: HandObservation[];
  engine: PerceptionEngine;
  fps: number;
  inferenceMs: number;
  timing?: FrameTiming;
  diagnostics?: PerceptionDiagnostics;
}

export type PerceptionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'running'
  | 'unavailable'
  | 'error';

export interface PerceptionSnapshot {
  status: PerceptionStatus;
  frame: PerceptionFrame | null;
  error?: string;
  warning?: string;
}
