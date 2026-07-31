import { interactionConfig } from '../config/interactionConfig';
import { MediaPipeHandService } from './MediaPipeHandService';
import { MediaPipePoseService } from './MediaPipePoseService';
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
  private poseService: MediaPipePoseService | null = null;
  private handService: MediaPipeHandService | null = null;
  private animationFrame = 0;
  private running = false;
  private busy = false;
  private lastInferenceAt = 0;
  private frameTimes: number[] = [];
  private previousPeople: PersonObservation[] = [];
  private nextPersonId = 1;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly listener: SnapshotListener,
  ) {}

  async initialize() {
    this.listener({ status: 'loading', frame: null });
    try {
      const modelResponses = await Promise.all([
        fetch(interactionConfig.mediaPipe.poseModelPath, { method: 'HEAD' }),
        fetch(interactionConfig.mediaPipe.handModelPath, { method: 'HEAD' }),
      ]);
      if (modelResponses.some((response) => !isMediaPipeModelResponse(response))) {
        throw new Error(
          'MediaPipe model assets are missing. Run "npm run models" or use the touch fallback.',
        );
      }
      [this.poseService, this.handService] = await Promise.all([
        MediaPipePoseService.create(),
        MediaPipeHandService.create(),
      ]);
      this.listener({ status: 'ready', frame: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to initialize local MediaPipe models.';
      this.listener({ status: 'unavailable', frame: null, error: message });
      throw error;
    }
  }

  async start() {
    if (!this.poseService || !this.handService) await this.initialize();
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
    this.handService?.close();
    this.poseService = null;
    this.handService = null;
  }

  private schedule = () => {
    if (!this.running) return;
    this.animationFrame = window.requestAnimationFrame(this.processFrame);
  };

  private processFrame = () => {
    this.schedule();
    const now = performance.now();
    const interval = 1000 / interactionConfig.mediaPipe.targetFps;
    if (
      this.busy ||
      now - this.lastInferenceAt < interval ||
      this.video.readyState < 2 ||
      !this.poseService ||
      !this.handService
    ) {
      return;
    }

    this.busy = true;
    const inferenceStarted = performance.now();
    try {
      const people = this.stabilizePersonIds(
        this.poseService.detect(this.video, now),
      );
      const hands = this.handService.detect(this.video, now);
      const completedAt = performance.now();
      this.lastInferenceAt = completedAt;
      this.frameTimes = [
        ...this.frameTimes.filter((timestamp) => completedAt - timestamp <= 1000),
        completedAt,
      ];
      const frame: PerceptionFrame = {
        timestamp: completedAt,
        people,
        hands,
        fps: this.frameTimes.length,
        inferenceMs: completedAt - inferenceStarted,
      };
      this.listener({ status: 'running', frame });
    } catch (error) {
      this.listener({
        status: 'error',
        frame: null,
        error:
          error instanceof Error ? error.message : 'MediaPipe inference failed.',
      });
    } finally {
      this.busy = false;
    }
  };

  private stabilizePersonIds(people: PersonObservation[]) {
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
