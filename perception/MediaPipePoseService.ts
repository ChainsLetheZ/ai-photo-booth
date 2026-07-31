import type { PoseLandmarker as PoseLandmarkerInstance } from '@mediapipe/tasks-vision';
import { interactionConfig } from '../config/interactionConfig';
import type { Landmark, PersonObservation } from './types';
import { getVisionFileset } from './visionFiles';

const CENTER_LANDMARKS = [11, 12, 23, 24];

function copyLandmark(landmark: {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}): Landmark {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility,
    presence: landmark.presence,
  };
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

export class MediaPipePoseService {
  private constructor(private readonly landmarker: PoseLandmarkerInstance) {}

  static async create() {
    const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await getVisionFileset();
    const baseOptions = {
      modelAssetPath: interactionConfig.mediaPipe.poseModelPath,
      delegate: interactionConfig.mediaPipe.delegate,
    };

    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numPoses: interactionConfig.mediaPipe.maxPoses,
        minPoseDetectionConfidence:
          interactionConfig.mediaPipe.minimumPoseConfidence,
        minPosePresenceConfidence:
          interactionConfig.mediaPipe.minimumPoseConfidence,
        minTrackingConfidence: interactionConfig.mediaPipe.minimumPoseConfidence,
        outputSegmentationMasks: false,
      });
      return new MediaPipePoseService(landmarker);
    } catch (gpuError) {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: interactionConfig.mediaPipe.poseModelPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: interactionConfig.mediaPipe.maxPoses,
        minPoseDetectionConfidence:
          interactionConfig.mediaPipe.minimumPoseConfidence,
        minPosePresenceConfidence:
          interactionConfig.mediaPipe.minimumPoseConfidence,
        minTrackingConfidence: interactionConfig.mediaPipe.minimumPoseConfidence,
        outputSegmentationMasks: false,
      }).catch(() => {
        throw gpuError;
      });
      return new MediaPipePoseService(landmarker);
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): PersonObservation[] {
    const result = this.landmarker.detectForVideo(video, timestamp);
    return result.landmarks.map((landmarks, index) => {
      const copied = landmarks.map(copyLandmark);
      const centers = CENTER_LANDMARKS.map((landmarkIndex) => copied[landmarkIndex])
        .filter(Boolean);
      const confidence = mean(
        copied
          .map((landmark) => landmark.visibility ?? landmark.presence ?? 1)
          .filter(Number.isFinite),
      );
      return {
        id: `pose-${index}`,
        poseLandmarks: copied,
        centerX: mean(centers.map((landmark) => landmark.x)),
        centerY: mean(centers.map((landmark) => landmark.y)),
        visibleConfidence: confidence,
      };
    });
  }

  close() {
    this.landmarker.close();
  }
}
