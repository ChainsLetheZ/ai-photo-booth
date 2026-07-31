import { interactionConfig } from '../config/interactionConfig';
import { MediaPipePoseService } from './MediaPipePoseService';
import { MoveNetPoseService } from './MoveNetPoseService';
import type { PoseEstimator } from './PoseEstimator';
import type {
  PerceptionFrame,
  PerceptionSnapshot,
  PersonObservation,
} from './types';

type SnapshotListener = (snapshot: PerceptionSnapshot) => void;

function isMediaPipeModelResponse(response: Response) {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html')) return false;
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : Number.NaN;
  return !Number.isFinite(contentLength) || contentLength >= 1_000_000;
}
function distance(
  first: Pick<PersonObservation, 'centerX' | 'centerY'>,
  second: Pick<PersonObservation, 'centerX' | 'centerY'>,
) {
  return Math.hypot(first.centerX - second.centerX, first.centerY - second.centerY);
}

export class PerceptionManager {
  private poseService: PoseEstimator | null = null;
  private animationFrame = 0;
  private running = false;
  private busy = false;
  private lastInferenceAt = 0;
  private frameTimes: number[] = [];
  private previousPeople: PersonObservation[] = [];
  private nextPersonId = 1;
  private warning: string | undefined;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly listener: SnapshotListener,
  ) {}

  async initialize() {
    this.listener({ status: 'loading', frame: null });
    try {
      if (interactionConfig.perception.preferredEngine === 'movenet') {
        try {
          this.poseService = await MoveNetPoseService.create();
        } catch (error) {
          if (!interactionConfig.perception.allowMediaPipeFallback) throw error;
          this.warning =
            error instanceof Error
              ? `${error.message} Using MediaPipe development fallback.`
              : 'MoveNet unavailable. Using MediaPipe development fallback.';
          this.poseService = await this.createMediaPipeFallback();
        }
      } else {
        this.poseService = await this.createMediaPipeFallback();
      }
      this.listener({
        status: 'ready',
        frame: null,
        warning: this.warning,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to initialize local pose perception.';
      this.listener({
        status: 'unavailable',
        frame: null,
        error: message,
        warning: this.warning,
      });
      throw error;
    }
  }

  async start() {
    if (!this.poseService) await this.initialize();
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    window.cancelAnimationFrame(this.animationFrame);
  }

  close() {
    this.stop();
    this.poseService?.close();
    this.poseService = null;
  }

  private async createMediaPipeFallback() {
    const response = await fetch(interactionConfig.mediaPipe.poseModelPath, {
      method: 'HEAD',
    });
    if (!isMediaPipeModelResponse(response)) {
      throw new Error(
        'The local MediaPipe fallback model is missing. Run "npm run models".',
      );
    }
    return MediaPipePoseService.create();
  }

  private schedule = () => {
    if (!this.running) return;
    this.animationFrame = window.requestAnimationFrame(this.processFrame);
  };

  private processFrame = async () => {
    this.schedule();
    const now = performance.now();
    const interval = 1000 / interactionConfig.perception.targetFps;
    if (
      this.busy ||
      now - this.lastInferenceAt < interval ||
      this.video.readyState < 2 ||
      !this.poseService
    ) {
      return;
    }

    this.busy = true;
    const inferenceStarted = performance.now();
    try {
      const detected = await this.poseService.detect(this.video, now);
      const people =
        this.poseService.engine === 'movenet'
          ? detected
          : this.stabilizeFallbackIds(detected);
      const completedAt = performance.now();
      this.lastInferenceAt = completedAt;
      this.frameTimes = [
        ...this.frameTimes.filter((timestamp) => completedAt - timestamp <= 1000),
        completedAt,
      ];
      const frame: PerceptionFrame = {
        timestamp: completedAt,
        people,
        hands: [],
        engine: this.poseService.engine,
        fps: this.frameTimes.length,
        inferenceMs: completedAt - inferenceStarted,
      };
      this.listener({
        status: 'running',
        frame,
        warning: this.warning,
      });
    } catch (error) {
      this.listener({
        status: 'error',
        frame: null,
        error:
          error instanceof Error ? error.message : 'Pose inference failed.',
        warning: this.warning,
      });
    } finally {
      this.busy = false;
    }
  };

  private stabilizeFallbackIds(people: PersonObservation[]) {
    const unmatched = [...this.previousPeople];
    const stable = people.map((person) => {
      let closestIndex = -1;
      let closestDistance = Number.POSITIVE_INFINITY;
      unmatched.forEach((candidate, index) => {
        const candidateDistance = distance(person, candidate);
        if (candidateDistance < closestDistance) {
          closestDistance = candidateDistance;
          closestIndex = index;
        }
      });

      if (closestIndex >= 0 && closestDistance < 0.22) {
        const [match] = unmatched.splice(closestIndex, 1);
        return { ...person, id: match.id };
      }
      return { ...person, id: `person-${this.nextPersonId++}` };
    });
    this.previousPeople = stable;
    return stable;
  }
}
