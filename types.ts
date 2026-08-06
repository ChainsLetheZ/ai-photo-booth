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
  personCount?: number;
  poseTrace?: PoseTrace[];
  shortCode?: string;
}

export interface PoseTraceKeypoint {
  name: string;
  x: number;
  y: number;
  score: number;
}

export interface PoseTracePoint {
  x: number;
  y: number;
}

export interface PoseTrace {
  keypoints: PoseTraceKeypoint[];
  hullPoints: PoseTracePoint[];
  isInitiator: boolean;
}

export interface WallEntry {
  id: string;
  shortCode: string;
  createdAt: number;
  /**
   * The one image the wall draws. A submission carries the captured
   * `data:image/...` bytes; once stored this is a URL under `/media/wall`,
   * because the wall store keeps photo files beside itself rather than inline.
   *
   * There is deliberately no separate full-resolution copy: nothing on the
   * wall displays one. The booth keeps its own full image for printing.
   */
  imageUrl: string;
  primaryEnergy: PrimaryEnergy;
  secondaryDimension: SecondaryDimension;
  narrativeLine: string;
  personCount: number;
  poseTrace: PoseTrace[];
  poseTraceVersion: 2;
}

export type WallEntryDraft = Omit<WallEntry, 'shortCode' | 'createdAt'>;

export type WallEntrySubmission = WallEntryDraft & {
  requestedShortCode?: string;
};

export type WallSocketMessage =
  | { type: 'sync'; entries: WallEntry[] }
  | { type: 'entry_added'; entry: WallEntry };

export type BoothPhase =
  | 'idle'
  | 'select'
  | 'reading'
  | 'response'
  | 'direction'
  | 'countdown'
  | 'creating'
  | 'result';
