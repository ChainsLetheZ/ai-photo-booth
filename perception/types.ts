export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface PersonObservation {
  id: string;
  poseLandmarks: Landmark[];
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
}
