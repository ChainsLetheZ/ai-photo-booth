import type { PersonObservation } from '../perception/types';
import type { PoseTrace, PoseTracePoint } from '../types';
import {
  getCoverSourceRect,
  videoToScreen,
  type CoverRect,
} from '../utils/viewportTransform';

const PORTRAIT_WIDTH = 1200;
const PORTRAIT_INFORMATION_HEIGHT = 490;

function cross(origin: PoseTracePoint, first: PoseTracePoint, second: PoseTracePoint) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

function convexHull(points: PoseTracePoint[]) {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  const lower: PoseTracePoint[] = [];
  sorted.forEach((point) => {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });
  const upper: PoseTracePoint[] = [];
  [...sorted].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function mapPeopleToPortraitTrace(
  people: PersonObservation[],
  videoWidth: number,
  videoHeight: number,
  cover: CoverRect,
  initiatorId: string | null,
): PoseTrace[] {
  const photoHeight = Math.max(
    1,
    Math.round(PORTRAIT_WIDTH * (cover.sh / Math.max(1, cover.sw))),
  );
  const portraitHeight = photoHeight + PORTRAIT_INFORMATION_HEIGHT;
  const photoHeightRatio = photoHeight / portraitHeight;

  return people.map((person) => {
    const keypoints = Object.entries(person.keypoints).flatMap(
      ([name, landmark]) => {
        if (!landmark) return [];
        const capturePoint = videoToScreen(
          landmark.x * videoWidth,
          landmark.y * videoHeight,
          cover,
          1,
          1,
          false,
        );
        if (
          capturePoint.x < 0 ||
          capturePoint.x > 1 ||
          capturePoint.y < 0 ||
          capturePoint.y > 1
        ) {
          return [];
        }
        return [
          {
            name,
            x: capturePoint.x,
            y: capturePoint.y * photoHeightRatio,
            score: landmark.visibility ?? landmark.presence ?? 1,
          },
        ];
      },
    );
    return {
      keypoints,
      hullPoints: convexHull(
        keypoints.map(({ x, y }) => ({ x, y })),
      ),
      isInitiator: person.id === initiatorId,
    };
  });
}

export function capturePoseTrace(
  people: PersonObservation[],
  video: HTMLVideoElement,
  initiatorId: string | null,
): PoseTrace[] {
  const display = video.getBoundingClientRect();
  const videoWidth = Math.max(1, video.videoWidth || display.width);
  const videoHeight = Math.max(1, video.videoHeight || display.height);
  const cover = getCoverSourceRect(
    videoWidth,
    videoHeight,
    Math.max(1, display.width),
    Math.max(1, display.height),
  );
  return mapPeopleToPortraitTrace(
    people,
    videoWidth,
    videoHeight,
    cover,
    initiatorId,
  );
}
