import { interactionConfig } from '../config/interactionConfig';
import type { PoseEstimator } from './PoseEstimator';
import type {
  BodyJoint,
  BodyKeypoints,
  Landmark,
  NormalizedBounds,
  PersonObservation,
} from './types';

type RuntimeWindow = Window & {
  tf?: {
    ready(): Promise<void>;
    setBackend(name: string): Promise<boolean>;
  };
  poseDetection?: {
    SupportedModels: { MoveNet: unknown };
    TrackerType?: { BoundingBox: unknown };
    movenet: {
      modelType: { MULTIPOSE_LIGHTNING: unknown };
    };
    createDetector(
      model: unknown,
      config: Record<string, unknown>,
    ): Promise<MoveNetDetector>;
  };
};

interface MoveNetKeypoint {
  x: number;
  y: number;
  score?: number;
  name?: string;
}

interface MoveNetPose {
  id?: number | string;
  score?: number;
  keypoints: MoveNetKeypoint[];
  box?: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width?: number;
    height?: number;
  };
}

interface MoveNetDetector {
  estimatePoses(
    input: HTMLVideoElement | HTMLCanvasElement,
    config?: Record<string, unknown>,
    timestamp?: number,
  ): Promise<MoveNetPose[]>;
  dispose(): void;
}

interface DetectionInput {
  element: HTMLVideoElement | HTMLCanvasElement;
  inputWidth: number;
  inputHeight: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

const JOINT_NAMES: Record<string, BodyJoint> = {
  nose: 'nose',
  left_shoulder: 'leftShoulder',
  right_shoulder: 'rightShoulder',
  left_elbow: 'leftElbow',
  right_elbow: 'rightElbow',
  left_wrist: 'leftWrist',
  right_wrist: 'rightWrist',
  left_hip: 'leftHip',
  right_hip: 'rightHip',
  left_knee: 'leftKnee',
  right_knee: 'rightKnee',
  left_ankle: 'leftAnkle',
  right_ankle: 'rightAnkle',
};

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function loadScript(src: string) {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-movenet-src="${src}"]`,
  );
  if (existing?.dataset.loaded === 'true') return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    script.dataset.movenetSrc = src;
    script.async = false;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error(`Unable to load MoveNet runtime: ${src}`)),
      { once: true },
    );
    if (!existing) {
      script.src = src;
      document.head.appendChild(script);
    }
  });
}

function isLocalModelResponse(response: Response) {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return !contentType.includes('text/html');
}

function normalizedBounds(
  pose: MoveNetPose,
  input: DetectionInput,
  videoWidth: number,
  videoHeight: number,
  landmarks: Landmark[],
): NormalizedBounds {
  if (pose.box) {
    const xMin =
      (input.sourceX +
        (pose.box.xMin / input.inputWidth) * input.sourceWidth) /
      videoWidth;
    const yMin =
      (input.sourceY +
        (pose.box.yMin / input.inputHeight) * input.sourceHeight) /
      videoHeight;
    const xMax =
      (input.sourceX +
        (pose.box.xMax / input.inputWidth) * input.sourceWidth) /
      videoWidth;
    const yMax =
      (input.sourceY +
        (pose.box.yMax / input.inputHeight) * input.sourceHeight) /
      videoHeight;
    return {
      xMin,
      yMin,
      xMax,
      yMax,
      width: xMax - xMin,
      height: yMax - yMin,
    };
  }
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const xMin = Math.max(0, Math.min(...xs));
  const yMin = Math.max(0, Math.min(...ys));
  const xMax = Math.min(1, Math.max(...xs));
  const yMax = Math.min(1, Math.max(...ys));
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

export class MoveNetPoseService implements PoseEstimator {
  readonly engine = 'movenet' as const;
  private readonly interactionCanvas = document.createElement('canvas');
  private readonly interactionContext =
    this.interactionCanvas.getContext('2d', { alpha: false });

  private constructor(private readonly detector: MoveNetDetector) {}

  static async create() {
    const modelResponse = await fetch(interactionConfig.moveNet.modelPath, {
      method: 'HEAD',
    });
    if (!isLocalModelResponse(modelResponse)) {
      throw new Error(
        `MoveNet model is not installed at ${interactionConfig.moveNet.modelPath}.`,
      );
    }

    for (const scriptUrl of interactionConfig.moveNet.scriptUrls) {
      await loadScript(scriptUrl);
    }

    const runtime = window as RuntimeWindow;
    if (!runtime.tf || !runtime.poseDetection) {
      throw new Error('MoveNet browser runtime did not initialize.');
    }
    await runtime.tf.setBackend('webgl');
    await runtime.tf.ready();

    const detector = await runtime.poseDetection.createDetector(
      runtime.poseDetection.SupportedModels.MoveNet,
      {
        modelType:
          runtime.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        modelUrl: interactionConfig.moveNet.modelPath,
        enableTracking: true,
        trackerType: runtime.poseDetection.TrackerType?.BoundingBox,
      },
    );
    const service = new MoveNetPoseService(detector);
    await service.warmUp();
    return service;
  }

  private async warmUp() {
    if (!this.interactionContext) return;
    this.interactionCanvas.width = 256;
    this.interactionCanvas.height = 256;
    this.interactionContext.fillStyle = '#000000';
    this.interactionContext.fillRect(0, 0, 256, 256);
    await this.detector.estimatePoses(
      this.interactionCanvas,
      {
        maxPoses: interactionConfig.perception.maxDetectedPoses,
        flipHorizontal: false,
      },
      performance.now(),
    );
  }

  private prepareInteractionInput(video: HTMLVideoElement): DetectionInput {
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

    if (!this.interactionContext) {
      return {
        element: video,
        inputWidth: videoWidth,
        inputHeight: videoHeight,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: videoWidth,
        sourceHeight: videoHeight,
      };
    }

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
    return {
      element: this.interactionCanvas,
      inputWidth: sourceWidth,
      inputHeight: sourceHeight,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
    };
  }

  async detect(video: HTMLVideoElement): Promise<PersonObservation[]> {
    const width = Math.max(1, video.videoWidth);
    const height = Math.max(1, video.videoHeight);
    const input = this.prepareInteractionInput(video);
    const poses = await this.detector.estimatePoses(input.element, {
      maxPoses: interactionConfig.perception.maxDetectedPoses,
      flipHorizontal: false,
    }, performance.now());

    return poses
      .filter(
        (pose) =>
          (pose.score ?? 1) >= interactionConfig.moveNet.scoreThreshold,
      )
      .map((pose, index) => {
        const landmarks = pose.keypoints.map((point) => ({
          x:
            (input.sourceX +
              (point.x / input.inputWidth) * input.sourceWidth) /
            width,
          y:
            (input.sourceY +
              (point.y / input.inputHeight) * input.sourceHeight) /
            height,
          z: 0,
          visibility: point.score ?? 1,
        }));
        const keypoints: BodyKeypoints = {};
        pose.keypoints.forEach((point, keypointIndex) => {
          const jointName =
            (point.name && JOINT_NAMES[point.name]) ||
            (keypointIndex < 17
              ? JOINT_NAMES[
                  [
                    'nose',
                    'left_eye',
                    'right_eye',
                    'left_ear',
                    'right_ear',
                    'left_shoulder',
                    'right_shoulder',
                    'left_elbow',
                    'right_elbow',
                    'left_wrist',
                    'right_wrist',
                    'left_hip',
                    'right_hip',
                    'left_knee',
                    'right_knee',
                    'left_ankle',
                    'right_ankle',
                  ][keypointIndex]
                ]
              : undefined);
          if (jointName) keypoints[jointName] = landmarks[keypointIndex];
        });
        const bounds = normalizedBounds(
          pose,
          input,
          width,
          height,
          landmarks,
        );
        const ankles = [keypoints.leftAnkle, keypoints.rightAnkle].filter(
          (point): point is Landmark => Boolean(point),
        );
        const centers = [
          keypoints.leftShoulder,
          keypoints.rightShoulder,
          keypoints.leftHip,
          keypoints.rightHip,
        ].filter((point): point is Landmark => Boolean(point));
        return {
          id: `movenet-${pose.id ?? index}`,
          source: this.engine,
          poseLandmarks: landmarks,
          keypoints,
          bounds,
          footPoint: {
            x: ankles.length
              ? mean(ankles.map((point) => point.x))
              : (bounds.xMin + bounds.xMax) / 2,
            y: ankles.length
              ? Math.max(...ankles.map((point) => point.y))
              : bounds.yMax,
          },
          centerX: centers.length
            ? mean(centers.map((point) => point.x))
            : (bounds.xMin + bounds.xMax) / 2,
          centerY: centers.length
            ? mean(centers.map((point) => point.y))
            : (bounds.yMin + bounds.yMax) / 2,
          visibleConfidence: mean(
            pose.keypoints.map((point) => point.score ?? 1),
          ),
        };
      });
  }

  close() {
    this.detector.dispose();
  }
}
