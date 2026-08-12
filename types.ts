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
  /** Original camera frame, retained for the wall's unframed photo river. */
  sourceImageData?: string;
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
  /** Unguessable public token used by the phone claim URL. */
  claimToken: string;
  createdAt: number;
  /** The KV-composed portrait used by the wall's non-river formations. */
  imageUrl: string;
  /**
   * Original camera capture used by the resting photo river. Optional for
   * compatibility with portraits collected before this field existed.
   */
  sourceImageUrl?: string;
  primaryEnergy: PrimaryEnergy;
  secondaryDimension: SecondaryDimension;
  narrativeLine: string;
  personCount: number;
  poseTrace: PoseTrace[];
  poseTraceVersion: 2;
}

export type WallEntryDraft = Omit<
  WallEntry,
  'shortCode' | 'claimToken' | 'createdAt'
>;

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
