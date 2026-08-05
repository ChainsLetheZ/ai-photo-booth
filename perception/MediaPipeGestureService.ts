import type {
  GestureRecognizer as GestureRecognizerInstance,
} from '@mediapipe/tasks-vision';
import { handGesture } from '../config/simpleMode';
import type { Landmark, PersonObservation } from './types';
import { getVisionFileset } from './visionFiles';

export type AcceptedHandGesture =
  (typeof handGesture.acceptedCategories)[number];

export interface RaisedWristCandidate {
  key: string;
  personId: string;
  side: 'left' | 'right';
  wrist: Landmark;
  shoulder: Landmark;
  shoulderWidthPx: number;
}

export interface HandCrop {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
  sourceWidth: number;
  sourceHeight: number;
  inputSize: number;
  personId: string;
  side: 'left' | 'right';
}

export type HandGestureStatus =
  | 'disabled'
  | 'loading'
  | 'ready'
  | 'not-installed'
  | 'error';

export interface HandGestureSnapshot {
  enabled: boolean;
  status: HandGestureStatus;
  gated: boolean;
  category: AcceptedHandGesture | null;
  confidence: number;
  stableCount: number;
  stableTarget: number;
  confirmed: boolean;
  crop: HandCrop | null;
  inferenceMs: number | null;
  inferenceCount: number;
  lastRunAt: number | null;
  error?: string;
}

export function raisedWristCandidates(
  people: PersonObservation[],
  videoWidth: number,
  videoHeight: number,
): RaisedWristCandidate[] {
  return people.flatMap((person) => {
    const leftShoulder = person.keypoints.leftShoulder;
    const rightShoulder = person.keypoints.rightShoulder;
    if (!leftShoulder || !rightShoulder) return [];
    const shoulderWidthPx = Math.hypot(
      (rightShoulder.x - leftShoulder.x) * videoWidth,
      (rightShoulder.y - leftShoulder.y) * videoHeight,
    );
    if (shoulderWidthPx <= Number.EPSILON) return [];
    return (['left', 'right'] as const).flatMap((side) => {
      const shoulder =
        side === 'left' ? leftShoulder : rightShoulder;
      const wrist =
        side === 'left'
          ? person.keypoints.leftWrist
          : person.keypoints.rightWrist;
      // This is deliberately the only runtime gate. No confidence, hold or
      // gesture threshold is allowed to start MediaPipe while the hand is down.
      if (!wrist || wrist.y >= shoulder.y) return [];
      return [{
        key: `${person.id}:${side}`,
        personId: person.id,
        side,
        wrist,
        shoulder,
        shoulderWidthPx,
      }];
    });
  });
}

export function computeHandCrop(
  candidate: RaisedWristCandidate,
  videoWidth: number,
  videoHeight: number,
): HandCrop {
  const maxSize = Math.max(1, Math.min(videoWidth, videoHeight));
  const sourceSize = Math.max(
    1,
    Math.min(
      maxSize,
      Math.round(
        candidate.shoulderWidthPx * handGesture.cropShoulderWidthFactor,
      ),
    ),
  );
  const centerX = candidate.wrist.x * videoWidth;
  const centerY = candidate.wrist.y * videoHeight;
  const sourceX = Math.round(
    Math.max(0, Math.min(videoWidth - sourceSize, centerX - sourceSize / 2)),
  );
  const sourceY = Math.round(
    Math.max(0, Math.min(videoHeight - sourceSize, centerY - sourceSize / 2)),
  );
  return {
    sourceX,
    sourceY,
    sourceSize,
    sourceWidth: videoWidth,
    sourceHeight: videoHeight,
    inputSize: handGesture.inputSize,
    personId: candidate.personId,
    side: candidate.side,
  };
}

export function handRecognitionDue(
  lastRunAt: number | null,
  timestamp: number,
) {
  return (
    lastRunAt === null ||
    timestamp - lastRunAt >= 1000 / handGesture.recognizeHz
  );
}

export class GestureConfirmationTracker {
  private category: AcceptedHandGesture | null = null;
  private candidateKey: string | null = null;
  private count = 0;

  update(
    category: AcceptedHandGesture | null,
    confidence: number,
    candidateKey: string,
  ) {
    if (category === null || confidence < handGesture.minConfidence) {
      this.reset();
      return { category: null, count: 0, confirmed: false } as const;
    }
    if (this.category === category && this.candidateKey === candidateKey) {
      this.count += 1;
    } else {
      this.category = category;
      this.candidateKey = candidateKey;
      this.count = 1;
    }
    return {
      category,
      count: this.count,
      confirmed: this.count >= handGesture.stableConfirmations,
    };
  }

  reset() {
    this.category = null;
    this.candidateKey = null;
    this.count = 0;
  }
}

const initialSnapshot = (): HandGestureSnapshot => ({
  enabled: handGesture.enabled,
  status: handGesture.enabled ? 'loading' : 'disabled',
  gated: false,
  category: null,
  confidence: 0,
  stableCount: 0,
  stableTarget: handGesture.stableConfirmations,
  confirmed: false,
  crop: null,
  inferenceMs: null,
  inferenceCount: 0,
  lastRunAt: null,
});

export class MediaPipeGestureService {
  private recognizer: GestureRecognizerInstance | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { alpha: false });
  private readonly confirmation = new GestureConfirmationTracker();
  private snapshot = initialSnapshot();
  private candidateCursor = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly listener: (snapshot: HandGestureSnapshot) => void,
  ) {
    this.canvas.width = handGesture.inputSize;
    this.canvas.height = handGesture.inputSize;
  }

  async initialize() {
    if (!handGesture.enabled) {
      this.patch({ enabled: false, status: 'disabled' });
      return;
    }
    this.patch({ enabled: true, status: 'loading', error: undefined });
    try {
      const modelResponse = await fetch(handGesture.modelPath, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (!modelResponse.ok) {
        this.patch({
          enabled: false,
          status: 'not-installed',
          error: `Local model returned HTTP ${modelResponse.status}`,
        });
        return;
      }

      const [{ GestureRecognizer }, fileset] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        getVisionFileset(),
      ]);
      const makeRecognizer = (delegate: 'GPU' | 'CPU') =>
        GestureRecognizer.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: handGesture.modelPath,
            delegate,
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence:
            handGesture.minHandDetectionConfidence,
          minHandPresenceConfidence:
            handGesture.minHandPresenceConfidence,
          minTrackingConfidence: handGesture.minTrackingConfidence,
          cannedGesturesClassifierOptions: {
            scoreThreshold: handGesture.minConfidence,
            categoryAllowlist: [...handGesture.acceptedCategories],
          },
        });
      try {
        this.recognizer = await makeRecognizer('GPU');
      } catch (gpuError) {
        console.warn('GPU gesture recognizer failed; using CPU.', gpuError);
        this.recognizer = await makeRecognizer('CPU');
      }
      this.patch({ enabled: true, status: 'ready', error: undefined });
    } catch (error) {
      this.patch({
        enabled: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  update(people: PersonObservation[], timestamp: number) {
    if (!this.recognizer || this.snapshot.status !== 'ready' || !this.context) {
      return this.snapshot;
    }
    const videoWidth = Math.max(1, this.video.videoWidth);
    const videoHeight = Math.max(1, this.video.videoHeight);
    const candidates = raisedWristCandidates(people, videoWidth, videoHeight);
    if (!candidates.length) {
      this.confirmation.reset();
      this.patch({
        gated: false,
        category: null,
        confidence: 0,
        stableCount: 0,
        confirmed: false,
        crop: null,
      });
      return this.snapshot;
    }

    this.patch({ gated: true });
    if (!handRecognitionDue(this.snapshot.lastRunAt, timestamp)) {
      return this.snapshot;
    }

    const candidate = candidates[this.candidateCursor % candidates.length];
    this.candidateCursor += 1;
    const crop = computeHandCrop(candidate, videoWidth, videoHeight);
    this.context.drawImage(
      this.video,
      crop.sourceX,
      crop.sourceY,
      crop.sourceSize,
      crop.sourceSize,
      0,
      0,
      handGesture.inputSize,
      handGesture.inputSize,
    );

    const startedAt = performance.now();
    try {
      const result = this.recognizer.recognizeForVideo(this.canvas, timestamp);
      const inferenceMs = performance.now() - startedAt;
      const category = result.gestures
        .flat()
        .sort((first, second) => second.score - first.score)[0];
      const accepted = handGesture.acceptedCategories.includes(
        category?.categoryName as AcceptedHandGesture,
      )
        ? (category.categoryName as AcceptedHandGesture)
        : null;
      const confidence = category?.score ?? 0;
      const stable = this.confirmation.update(
        accepted,
        confidence,
        candidate.key,
      );
      this.patch({
        gated: true,
        category: stable.category,
        confidence,
        stableCount: stable.count,
        confirmed: stable.confirmed,
        crop,
        inferenceMs,
        inferenceCount: this.snapshot.inferenceCount + 1,
        lastRunAt: timestamp,
      });
    } catch (error) {
      this.recognizer?.close();
      this.recognizer = null;
      this.confirmation.reset();
      this.patch({
        enabled: false,
        status: 'error',
        gated: false,
        confirmed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.snapshot;
  }

  reset() {
    this.confirmation.reset();
    this.candidateCursor = 0;
    this.patch({
      gated: false,
      category: null,
      confidence: 0,
      stableCount: 0,
      confirmed: false,
      crop: null,
      inferenceMs: null,
      lastRunAt: null,
    });
  }

  close() {
    this.recognizer?.close();
    this.recognizer = null;
  }

  getSnapshot() {
    return this.snapshot;
  }

  private patch(update: Partial<HandGestureSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listener(this.snapshot);
  }
}
