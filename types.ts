export enum AppMode {
  PHOTO_BOOTH = 'PHOTO_BOOTH',
  MOSAIC_WALL = 'MOSAIC_WALL',
}

export interface Participant {
  id: string;
  imageData: string;
  timestamp: number;
  vibe: string;
  color: string;
  isUploaded?: boolean;
}

export interface GeminiAnalysis {
  vibe: string;
  color: string;
}
