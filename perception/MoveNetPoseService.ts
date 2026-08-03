import { interactionConfig } from '../config/interactionConfig';
import type { PoseEstimator } from './PoseEstimator';
import type {
  BodyJoint,
  BodyKeypoints,
  DetectionTiming,
  Landmark,
  NormalizedBounds,
  PersonObservation,
  PerceptionDiagnostics,
} from './types';

type RuntimeWindow = Window & {
  tf?: {
    ready(): Promise<void>;
    setBackend(name: string): Promise<boolean>;
    getBackend?(): string;
    memory?(): { numTensors: number };
    env?(): {
      getBool(name: string): boolean;
      getNumber(name: string): number;
      set(name: string, value: boolean | number): void;
    };
    browser?: {
      fromPixels(
        input: HTMLVideoElement | HTMLCanvasElement,
      ): MoveNetTensorInput;
    };
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
    input: HTMLVideoElement | HTMLCanvasElement | MoveNetTensorInput,
    config?: Record<string, unknown>,
    timestamp?: number,
  ): Promise<MoveNetPose[]>;
  dispose(): void;
}

interface MoveNetTensorInput {
  shape: number[];
  dispose(): void;
}

export interface MoveNetBenchmarkResult {
  iterations: number;
  modelType: 'MULTIPOSE_LIGHTNING';
  backend: string;
  webglPack: boolean | null;
  webglForceF16Textures: boolean | null;
  webglVersion: number | null;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  tensorBeforeInput: number | null;
  tensorAfterFirstRun: number | null;
  tensorAfterRuns: number | null;
  tensorAfterDispose: number | null;
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

function readRuntimeBool(
  runtime: NonNullable<RuntimeWindow['tf']>,
  name: string,
) {
  try {
    return runtime.env?.().getBool(name) ?? null;
  } catch {
    return null;
  }
}

function readRuntimeNumber(
  runtime: NonNullable<RuntimeWindow['tf']>,
  name: string,
) {
  try {
    return runtime.env?.().getNumber(name) ?? null;
  } catch {
    return null;
  }
}

function readTensorCount(runtime: NonNullable<RuntimeWindow['tf']>) {
  try {
    return runtime.memory?.().numTensors ?? null;
  } catch {
    return null;
  }
}

async function initializeMoveNetRuntime(forceF16Textures?: boolean) {
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
  if (forceF16Textures !== undefined) {
    runtime.tf.env?.().set('WEBGL_FORCE_F16_TEXTURES', forceF16Textures);
  }
  const backendReady = await runtime.tf.setBackend('webgl');
  await runtime.tf.ready();
  const activeBackend = runtime.tf.getBackend?.();
  if (!backendReady || (activeBackend && activeBackend !== 'webgl')) {
    throw new Error(
      `MoveNet requires the WebGL backend; active backend is ${activeBackend ?? 'unknown'}.`,
    );
  }
  return runtime as RuntimeWindow & {
    tf: NonNullable<RuntimeWindow['tf']>;
    poseDetection: NonNullable<RuntimeWindow['poseDetection']>;
  };
}

async function createMoveNetDetector(
  runtime: RuntimeWindow & {
    tf: NonNullable<RuntimeWindow['tf']>;
    poseDetection: NonNullable<RuntimeWindow['poseDetection']>;
  },
) {
  return runtime.poseDetection.createDetector(
    runtime.poseDetection.SupportedModels.MoveNet,
    {
      modelType:
        runtime.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      modelUrl: interactionConfig.moveNet.modelPath,
      enableTracking: true,
      trackerType: runtime.poseDetection.TrackerType?.BoundingBox,
    },
  );
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

export async function runMoveNetBenchmark(
  iterations = 100,
  forceF16Textures?: boolean,
): Promise<MoveNetBenchmarkResult> {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('Benchmark iterations must be a positive integer.');
  }
  const runtime = await initializeMoveNetRuntime(forceF16Textures);
  const detector = await createMoveNetDetector(runtime);
  const canvas = document.createElement('canvas');
  canvas.width = interactionConfig.perception.roiInputSize;
  canvas.height = interactionConfig.perception.roiInputSize;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || !runtime.tf.browser) {
    detector.dispose();
    throw new Error('Canvas/fromPixels is unavailable for the benchmark.');
  }
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const tensorBeforeInput = readTensorCount(runtime.tf);
  const input = runtime.tf.browser.fromPixels(canvas);
  const durations: number[] = [];
  let tensorAfterFirstRun: number | null = null;
  let tensorAfterRuns: number | null = null;
  try {
    for (let index = 0; index < iterations; index += 1) {
      const startedAt = performance.now();
      await detector.estimatePoses(
        input,
        {
          maxPoses: interactionConfig.perception.maxPoses,
          flipHorizontal: false,
        },
        performance.now(),
      );
      durations.push(performance.now() - startedAt);
      if (index === 0) tensorAfterFirstRun = readTensorCount(runtime.tf);
    }
    tensorAfterRuns = readTensorCount(runtime.tf);
  } finally {
    input.dispose();
    detector.dispose();
  }
  const tensorAfterDispose = readTensorCount(runtime.tf);
  return {
    iterations,
    modelType: 'MULTIPOSE_LIGHTNING',
    backend: runtime.tf.getBackend?.() ?? 'unknown',
    webglPack: readRuntimeBool(runtime.tf, 'WEBGL_PACK'),
    webglForceF16Textures: readRuntimeBool(
      runtime.tf,
      'WEBGL_FORCE_F16_TEXTURES',
    ),
    webglVersion: readRuntimeNumber(runtime.tf, 'WEBGL_VERSION'),
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    tensorBeforeInput,
    tensorAfterFirstRun,
    tensorAfterRuns,
    tensorAfterDispose,
  };
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

  private inputWidth = interactionConfig.perception.roiInputSize;
  private inputHeight = interactionConfig.perception.roiInputSize;
  private lastTiming: DetectionTiming = {
    captureMs: 0,
    inferMs: 0,
    postMs: 0,
  };

  private constructor(
    private readonly detector: MoveNetDetector,
    private readonly tfRuntime: NonNullable<RuntimeWindow['tf']>,
  ) {}

  static async create() {
    const runtime = await initializeMoveNetRuntime(
      interactionConfig.moveNet.forceF16Textures,
    );
    const detector = await createMoveNetDetector(runtime);
    const service = new MoveNetPoseService(detector, runtime.tf);
    await service.warmUp();
    return service;
  }

  private async warmUp() {
    if (!this.interactionContext) return;
    const inputSize = interactionConfig.perception.roiInputSize;
    this.interactionCanvas.width = inputSize;
    this.interactionCanvas.height = inputSize;
    this.interactionContext.fillStyle = '#000000';
    this.interactionContext.fillRect(0, 0, inputSize, inputSize);
    await this.detector.estimatePoses(
      this.interactionCanvas,
      {
        maxPoses: interactionConfig.perception.maxPoses,
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

    const inputSize = interactionConfig.perception.roiInputSize;
    if (
      this.interactionCanvas.width !== inputSize ||
      this.interactionCanvas.height !== inputSize
    ) {
      this.interactionCanvas.width = inputSize;
      this.interactionCanvas.height = inputSize;
    }
    this.interactionContext.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      inputSize,
      inputSize,
    );
    this.inputWidth = inputSize;
    this.inputHeight = inputSize;
    return {
      element: this.interactionCanvas,
      inputWidth: inputSize,
      inputHeight: inputSize,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
    };
  }

  async detect(video: HTMLVideoElement): Promise<PersonObservation[]> {
    const width = Math.max(1, video.videoWidth);
    const height = Math.max(1, video.videoHeight);
    const captureStarted = performance.now();
    const input = this.prepareInteractionInput(video);
    const tensorInput = this.tfRuntime.browser?.fromPixels(input.element);
    const captureMs = performance.now() - captureStarted;
    const inferStarted = performance.now();
    let poses: MoveNetPose[];
    try {
      poses = await this.detector.estimatePoses(
        tensorInput ?? input.element,
        {
          maxPoses: interactionConfig.perception.maxPoses,
          flipHorizontal: false,
        },
        performance.now(),
      );
    } finally {
      tensorInput?.dispose();
    }
    const inferMs = performance.now() - inferStarted;
    const postStarted = performance.now();

    const people = poses
      .filter(
        (pose) =>
          (pose.score ?? 1) >= interactionConfig.perception.minPoseScore,
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
          rawTrackId: `movenet-${pose.id ?? index}`,
          source: this.engine,
          poseScore: pose.score,
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
    this.lastTiming = {
      captureMs,
      inferMs,
      postMs: performance.now() - postStarted,
    };
    return people;
  }

  getLastTiming(): DetectionTiming {
    return this.lastTiming;
  }

  getDiagnostics(): PerceptionDiagnostics {
    let numTensors: number | null = null;
    try {
      numTensors = this.tfRuntime.memory?.().numTensors ?? null;
    } catch {
      numTensors = null;
    }
    return {
      backend: this.tfRuntime.getBackend?.() ?? 'unknown',
      numTensors,
      roiInputWidth: this.inputWidth,
      roiInputHeight: this.inputHeight,
      maxPoses: interactionConfig.perception.maxPoses,
      modelType: 'MULTIPOSE_LIGHTNING',
      webglFlags: {
        WEBGL_PACK: this.readWebglBool('WEBGL_PACK'),
        WEBGL_FORCE_F16_TEXTURES: this.readWebglBool(
          'WEBGL_FORCE_F16_TEXTURES',
        ),
        WEBGL_RENDER_FLOAT32_CAPABLE: this.readWebglBool(
          'WEBGL_RENDER_FLOAT32_CAPABLE',
        ),
        WEBGL_VERSION: this.readWebglNumber('WEBGL_VERSION'),
      },
    };
  }

  private readWebglBool(name: string): boolean | null {
    try {
      return this.tfRuntime.env?.().getBool(name) ?? null;
    } catch {
      return null;
    }
  }

  private readWebglNumber(name: string): number | null {
    try {
      return this.tfRuntime.env?.().getNumber(name) ?? null;
    } catch {
      return null;
    }
  }

  close() {
    this.detector.dispose();
  }
}
