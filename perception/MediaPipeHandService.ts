import type { HandLandmarker as HandLandmarkerInstance } from '@mediapipe/tasks-vision';
import { interactionConfig } from '../config/interactionConfig';
import type { HandObservation, Landmark } from './types';
import { getVisionFileset } from './visionFiles';

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

export class MediaPipeHandService {
  private constructor(private readonly landmarker: HandLandmarkerInstance) {}

  static async create() {
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await getVisionFileset();
    const baseOptions = {
      modelAssetPath: interactionConfig.mediaPipe.handModelPath,
      delegate: interactionConfig.mediaPipe.delegate,
    };

    try {
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numHands: interactionConfig.mediaPipe.maxHands,
        minHandDetectionConfidence:
          interactionConfig.mediaPipe.minimumHandConfidence,
        minHandPresenceConfidence:
          interactionConfig.mediaPipe.minimumHandConfidence,
        minTrackingConfidence: interactionConfig.mediaPipe.minimumHandConfidence,
      });
      return new MediaPipeHandService(landmarker);
    } catch (gpuError) {
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: interactionConfig.mediaPipe.handModelPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: interactionConfig.mediaPipe.maxHands,
        minHandDetectionConfidence:
          interactionConfig.mediaPipe.minimumHandConfidence,
        minHandPresenceConfidence:
          interactionConfig.mediaPipe.minimumHandConfidence,
        minTrackingConfidence: interactionConfig.mediaPipe.minimumHandConfidence,
      }).catch(() => {
        throw gpuError;
      });
      return new MediaPipeHandService(landmarker);
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): HandObservation[] {
    const result = this.landmarker.detectForVideo(video, timestamp);
    return result.landmarks.map((landmarks, index) => {
      const copied: Landmark[] = landmarks.map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
      }));
      const handedness = result.handednesses[index]?.[0];
      return {
        id: `hand-${index}`,
        handedness:
          handedness?.categoryName.toLowerCase() === 'left' ? 'left' : 'right',
        landmarks: copied,
        centerX: mean(copied.map((landmark) => landmark.x)),
        centerY: mean(copied.map((landmark) => landmark.y)),
        confidence: handedness?.score ?? 1,
      };
    });
  }

  close() {
    this.landmarker.close();
  }
}
