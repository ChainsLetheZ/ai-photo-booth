export type PrimaryEnergy = 'Motion' | 'Intelligence' | 'Life' | 'Impact';

export type SecondaryDimension =
  | 'Collaboration'
  | 'Precision'
  | 'Momentum'
  | 'Exploration';

export type GroupMode = 'Single' | 'Pair' | 'Group';

export interface BehaviorReading {
  peopleCount: number;
  mode: GroupMode;
  movement: number;
  stability: number;
  cohesion: number;
  secondary: SecondaryDimension;
}

export interface PortraitRecord {
  id: string;
  imageData: string;
  timestamp: number;
  primary: PrimaryEnergy;
  secondary: SecondaryDimension;
  mode: GroupMode;
  narrative: string;
  color: string;
}

export type BoothPhase =
  | 'idle'
  | 'select'
  | 'reading'
  | 'response'
  | 'direction'
  | 'countdown'
  | 'creating'
  | 'result';
