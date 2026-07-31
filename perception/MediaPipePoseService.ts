import type { PoseLandmarker as PoseLandmarkerInstance } from '@mediapipe/tasks-vision';
import { interactionConfig } from '../config/interactionConfig';
import type { BodyKeypoints, Landmark, PersonObservation } from './types';
import type { PoseEstimator } from './PoseEstimator';
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

function boundsFromLandmarks(landmarks: Landmark[]) {
  const visibleLandmarks = landmarks.filter(
    (landmark) =>
      Number.isFinite(landmark.x) &&
      Number.isFinite(landmark.y) &&
      (landmark.visibility ?? landmark.presence ?? 1) >= 0.2,
  );
  const visible = visibleLandmarks.length
    ? visibleLandmarks
    : landmarks.filter(
        (landmark) =>
          Number.isFinite(landmark.x) && Number.isFinite(landmark.y),
      );
  if (!visible.length) {
    return {
      xMin: 0,
      yMin: 0,
      xMax: 1,
      yMax: 1,
      width: 1,
      height: 1,
    };
  }
  const xs = visible.map((landmark) => landmark.x);
  const ys = visible.map((landmark) => landmark.y);
  const xMin = Math.max(0, Math.min(...xs));
  const yMin = Math.max(0, Math.min(...ys));
  const xMax = Math.min(1, Math.max(...xs));
  const yMax = Math.min(1, Math.max(...ys));
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width: Math.max(0, xMax - xMin),
    height: Math.max(0, yMax - yMin),
  };
}

function semanticKeypoints(landmarks: Landmark[]): BodyKeypoints {
  return {
    nose: landmarks[0],
    leftShoulder: landmarks[11],
    rightShoulder: landmarks[12],
    leftElbow: landmarks[13],
    rightElbow: landmarks[14],
    leftWrist: landmarks[15],
    rightWrist: landmarks[16],
    leftHip: landmarks[23],
    rightHip: landmarks[24],
    leftKnee: landmarks[25],
    rightKnee: landmarks[26],
    leftAnkle: landmarks[27],
    rightAnkle: landmarks[28],
  };
}

export class MediaPipePoseService implements PoseEstimator {
  readonly engine = 'mediapipe' as const;
  private readonly interactionCanvas = document.createElement('canvas');
  private readonly interactionContext =
    this.interactionCanvas.getContext('2d', { alpha: false });

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
    const videoWidth = Math.max(1, video.videoWidth);
    const videoHeight = Math.max(1, video.videoHeight);
    const roi = interactionConfig.perception.interactionRoi;
    const sourceX = Math.round(videoWidth * roi.xMin);
    const sourceY = Math.round(videoHeight * roi.yMin);
    const sourceWidth = Math.max(
      1,
      Math.round(videoWidth * (roi.xMax - roi.xMin)),
    );
    const sourceHeight = Math.max(
      1,
      Math.round(videoHeight * (roi.yMax - roi.yMin)),
    );
    let input: HTMLVideoElement | HTMLCanvasElement = video;
    if (this.interactionContext) {
      if (
        this.interactionCanvas.width !== sourceWidth ||
        this.interactionCanvas.height !== sourceHeight
      ) {
        this.interactionCanvas.width = sourceWidth;
        this.interactionCanvas.height = sourceHeight;
      }
      this.interactionContext.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      input = this.interactionCanvas;
    }
    const result = this.landmarker.detectForVideo(input, timestamp);
    return result.landmarks.map((landmarks, index) => {
      const copied = landmarks.map((landmark) => {
        const copiedLandmark = copyLandmark(landmark);
        if (input === video) return copiedLandmark;
        return {
          ...copiedLandmark,
          x: (sourceX + copiedLandmark.x * sourceWidth) / videoWidth,
          y: (sourceY + copiedLandmark.y * sourceHeight) / videoHeight,
          z: copiedLandmark.z * (sourceWidth / videoWidth),
        };
      });
      const centers = CENTER_LANDMARKS.map((landmarkIndex) => copied[landmarkIndex])
        .filter(Boolean);
      const confidence = mean(
        copied
          .map((landmark) => landmark.visibility ?? landmark.presence ?? 1)
          .filter(Number.isFinite),
      );
      const bounds = boundsFromLandmarks(copied);
      const anklePoints = [copied[27], copied[28]].filter(Boolean);
      return {
        id: `pose-${index}`,
        source: this.engine,
        poseLandmarks: copied,
        keypoints: semanticKeypoints(copied),
        bounds,
        footPoint: {
          x: anklePoints.length
            ? mean(anklePoints.map((point) => point.x))
            : (bounds.xMin + bounds.xMax) / 2,
          y: Math.max(
            ...anklePoints.map((point) => point.y),
            bounds.yMax,
          ),
        },
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
