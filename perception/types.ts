export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
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

export interface PersonObservation {
  id: string;
  source: PerceptionEngine;
  poseLandmarks: Landmark[];
  keypoints: BodyKeypoints;
  bounds: NormalizedBounds;
  footPoint: { x: number; y: number };
  centerX: number;
  centerY: number;
  visibleConfidence: number;
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
