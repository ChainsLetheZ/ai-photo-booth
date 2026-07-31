import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { interactionConfig } from '../config/interactionConfig';

type VisionFileset = Parameters<typeof PoseLandmarker.createFromOptions>[0];

let filesetPromise: Promise<VisionFileset> | null = null;

export function getVisionFileset() {
  if (!filesetPromise) {
    filesetPromise = import('@mediapipe/tasks-vision').then(
      ({ FilesetResolver }) =>
        FilesetResolver.forVisionTasks(interactionConfig.mediaPipe.wasmPath),
    );
  }
  return filesetPromise;
}
