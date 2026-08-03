import React, { useEffect, useRef } from 'react';
import { interactionConfig } from '../config/interactionConfig';
import type { InteractionEngineSnapshot } from '../interaction/InteractionController';
import type {
  Landmark,
  PersonObservation,
} from '../perception/types';
import { recordRenderTiming } from '../perception/RenderTimingStore';

interface Props {
  snapshot: InteractionEngineSnapshot;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface ArmMotion {
  shoulder: ScreenPoint;
  wrist: ScreenPoint;
  progress: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function viewportTransform(
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const sourceWidth = Math.max(1, video.videoWidth || width);
  const sourceHeight = Math.max(1, video.videoHeight || height);
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;
  return {
    point(x: number, y: number) {
      return {
        x: width - (offsetX + x * renderedWidth),
        y: offsetY + y * renderedHeight,
      };
    },
    renderedWidth,
    renderedHeight,
  };
}

function haloColor(active: boolean, initiator: boolean) {
  if (initiator) return '89, 224, 255';
  return active ? '64, 201, 234' : '180, 223, 235';
}

function cross(origin: ScreenPoint, a: ScreenPoint, b: ScreenPoint) {
  return (
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x)
  );
}

function convexHull(points: ScreenPoint[]) {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  const lower: ScreenPoint[] = [];
  sorted.forEach((point) => {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });
  const upper: ScreenPoint[] = [];
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

function expandedHull(points: ScreenPoint[], padding: number) {
  const center = points.reduce(
    (total, point) => ({
      x: total.x + point.x / points.length,
      y: total.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
  return points.map((point) => {
    const deltaX = point.x - center.x;
    const deltaY = point.y - center.y;
    const length = Math.max(1, Math.hypot(deltaX, deltaY));
    return {
      x: point.x + (deltaX / length) * padding,
      y: point.y + (deltaY / length) * padding,
    };
  });
}

function sampleClosedPath(points: ScreenPoint[], spacing = 18) {
  if (points.length < 2) return points;
  const samples: ScreenPoint[] = [];
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const count = Math.max(1, Math.round(distance / spacing));
    for (let step = 0; step < count; step += 1) {
      const progress = step / count;
      samples.push({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      });
    }
  });
  return samples;
}

function visibleLandmarks(person: PersonObservation) {
  return Object.values(person.keypoints).filter(
    (point): point is Landmark =>
      Boolean(
        point &&
          (point.visibility ?? point.presence ?? 1) >=
            interactionConfig.moveNet.scoreThreshold,
      ),
  );
}

function bodyHull(
  person: PersonObservation,
  transform: ReturnType<typeof viewportTransform>,
) {
  return convexHull(
    visibleLandmarks(person).map((point) =>
      transform.point(point.x, point.y),
    ),
  );
}

function drawEllipseFallback(
  context: CanvasRenderingContext2D,
  person: PersonObservation,
  transform: ReturnType<typeof viewportTransform>,
) {
  const topLeft = transform.point(person.bounds.xMax, person.bounds.yMin);
  const bottomRight = transform.point(person.bounds.xMin, person.bounds.yMax);
  const centerX = (topLeft.x + bottomRight.x) / 2;
  const centerY = (topLeft.y + bottomRight.y) / 2;
  const radiusX = Math.max(46, Math.abs(bottomRight.x - topLeft.x) / 2 + 24);
  const radiusY = Math.max(82, Math.abs(bottomRight.y - topLeft.y) / 2 + 26);
  return sampleClosedPath(
    Array.from({ length: 20 }, (_, index) => {
      const angle = (index / 20) * Math.PI * 2;
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      };
    }),
  );
}

function drawHalo(
  context: CanvasRenderingContext2D,
  person: PersonObservation,
  transform: ReturnType<typeof viewportTransform>,
  time: number,
  active: boolean,
  initiator: boolean,
  ambient: boolean,
  motion: ArmMotion | null,
  confirmationElapsed: number | null,
) {
  const feedback = interactionConfig.feedback;
  const confirmationPulse =
    confirmationElapsed === null
      ? 0
      : Math.sin(
          clamp01(confirmationElapsed / feedback.confirmationSweepMs) *
            Math.PI,
        );
  const hull = bodyHull(person, transform);
  const padding = Math.max(12, 24 - confirmationPulse * 8);
  const samples =
    hull.length >= 3
      ? sampleClosedPath(expandedHull(hull, padding))
      : drawEllipseFallback(context, person, transform);
  const rgb = haloColor(active, initiator);
  const direction = motion
    ? {
        x: motion.wrist.x - motion.shoulder.x,
        y: motion.wrist.y - motion.shoulder.y,
      }
    : null;
  const directionLength = direction
    ? Math.max(1, Math.hypot(direction.x, direction.y))
    : 1;

  context.save();
  context.globalCompositeOperation = 'screen';
  samples.forEach((sample, index) => {
    const wristDistance = motion
      ? Math.hypot(sample.x - motion.wrist.x, sample.y - motion.wrist.y)
      : Number.POSITIVE_INFINITY;
    const proximity = motion
      ? Math.exp(-Math.pow(wristDistance / 135, 2)) * motion.progress
      : 0;
    const flow = Math.sin(time * 0.01 - index * 0.62) * 0.5 + 0.5;
    const x =
      sample.x +
      (direction ? direction.x / directionLength : 0) *
        proximity *
        (7 + flow * 8);
    const y =
      sample.y +
      (direction ? direction.y / directionLength : 0) *
        proximity *
        (7 + flow * 8);
    const baseEmphasis = ambient
      ? 0.15
      : initiator
        ? 0.66
        : active
          ? 0.48
          : 0.3;
    const emphasis = Math.min(
      0.98,
      baseEmphasis +
        proximity * 0.42 +
        confirmationPulse * (initiator ? 0.25 : 0.08),
    );
    const radius =
      1.15 +
      (index % 5 === 0 ? 1.3 : 0) +
      proximity * 1.8 +
      confirmationPulse * 0.7;
    context.fillStyle = `rgba(${rgb}, ${emphasis})`;
    context.shadowColor = `rgba(${rgb}, .9)`;
    context.shadowBlur = ambient ? 4 : initiator ? 14 : 8;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });

  if (!ambient && hull.length >= 3) {
    const outline = expandedHull(hull, padding);
    context.strokeStyle = `rgba(${rgb}, ${active ? 0.18 : 0.09})`;
    context.lineWidth = 1;
    context.setLineDash([2, 10]);
    context.lineJoin = 'round';
    context.beginPath();
    outline.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.stroke();
  }
  context.restore();
}

function pointOnArm(points: ScreenPoint[], progress: number) {
  const firstLength = Math.hypot(
    points[1].x - points[0].x,
    points[1].y - points[0].y,
  );
  const secondLength = Math.hypot(
    points[2].x - points[1].x,
    points[2].y - points[1].y,
  );
  const total = Math.max(1, firstLength + secondLength);
  const distance = clamp01(progress) * total;
  if (distance <= firstLength) {
    const section = distance / Math.max(1, firstLength);
    return {
      point: {
        x: points[0].x + (points[1].x - points[0].x) * section,
        y: points[0].y + (points[1].y - points[0].y) * section,
      },
      elbowReached: false,
    };
  }
  const section = (distance - firstLength) / Math.max(1, secondLength);
  return {
    point: {
      x: points[1].x + (points[2].x - points[1].x) * section,
      y: points[1].y + (points[2].y - points[1].y) * section,
    },
    elbowReached: true,
  };
}

function drawArm(
  context: CanvasRenderingContext2D,
  person: PersonObservation,
  arm: 'left' | 'right',
  transform: ReturnType<typeof viewportTransform>,
  holdProgress: number,
  confirmationElapsed: number | null,
) {
  const shoulder =
    arm === 'left'
      ? person.keypoints.leftShoulder
      : person.keypoints.rightShoulder;
  const elbow =
    arm === 'left' ? person.keypoints.leftElbow : person.keypoints.rightElbow;
  const wrist =
    arm === 'left' ? person.keypoints.leftWrist : person.keypoints.rightWrist;
  if (!shoulder || !elbow || !wrist) return;
  const points = [shoulder, elbow, wrist].map((point) =>
    transform.point(point.x, point.y),
  );
  const feedback = interactionConfig.feedback;
  const confirmed = confirmationElapsed !== null;
  const sweepProgress = confirmed
    ? clamp01(confirmationElapsed / feedback.confirmationSweepMs)
    : 1;
  const fade =
    !confirmed || confirmationElapsed <= feedback.confirmationSweepMs
      ? 1
      : clamp01(
          1 -
            (confirmationElapsed - feedback.confirmationSweepMs) /
              feedback.confirmationFadeMs,
        );
  if (fade <= 0) return;
  const sweep = pointOnArm(points, sweepProgress);

  context.save();
  context.globalCompositeOperation = 'screen';
  context.globalAlpha = fade;
  context.strokeStyle = confirmed
    ? 'rgba(255,255,255,.96)'
    : `rgba(89,224,255,${0.42 + holdProgress * 0.5})`;
  context.lineWidth = 3 + holdProgress * 2;
  context.shadowColor = '#59e0ff';
  context.shadowBlur = confirmed ? 24 : 12 + holdProgress * 14;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  if (confirmed) {
    if (sweep.elbowReached) {
      context.lineTo(points[1].x, points[1].y);
    }
    context.lineTo(sweep.point.x, sweep.point.y);
  } else {
    context.lineTo(points[1].x, points[1].y);
    context.lineTo(points[2].x, points[2].y);
  }
  context.stroke();

  points.forEach((point, index) => {
    const threshold = index / (points.length - 1);
    const reached = !confirmed || sweepProgress >= threshold;
    if (!reached) return;
    context.fillStyle =
      confirmed && index === 2 ? '#ffffff' : 'rgba(89,224,255,.96)';
    context.beginPath();
    context.arc(point.x, point.y, 5 + holdProgress * 3, 0, Math.PI * 2);
    context.fill();
  });

  if (confirmed) {
    context.fillStyle = '#ffffff';
    context.shadowBlur = 30;
    context.beginPath();
    context.arc(sweep.point.x, sweep.point.y, 6, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawFirstRecognition(
  context: CanvasRenderingContext2D,
  person: PersonObservation,
  transform: ReturnType<typeof viewportTransform>,
  progress: number,
) {
  const fade = Math.sin(clamp01(progress) * Math.PI);
  if (fade <= 0) return;
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = `rgba(201,244,255,${fade * 0.78})`;
  context.shadowColor = '#59e0ff';
  context.shadowBlur = 18;
  visibleLandmarks(person).forEach((point, index) => {
    const screenPoint = transform.point(point.x, point.y);
    const stagger = clamp01(progress * 1.8 - index * 0.045);
    if (stagger <= 0) return;
    context.beginPath();
    context.arc(
      screenPoint.x,
      screenPoint.y,
      2.5 + stagger * 2,
      0,
      Math.PI * 2,
    );
    context.fill();
  });
  context.restore();
}

function armMotionFor(
  person: PersonObservation,
  arm: 'left' | 'right' | null,
  transform: ReturnType<typeof viewportTransform>,
  progress: number,
): ArmMotion | null {
  if (!arm) return null;
  const shoulder =
    arm === 'left'
      ? person.keypoints.leftShoulder
      : person.keypoints.rightShoulder;
  const wrist =
    arm === 'left' ? person.keypoints.leftWrist : person.keypoints.rightWrist;
  if (!shoulder || !wrist) return null;
  return {
    shoulder: transform.point(shoulder.x, shoulder.y),
    wrist: transform.point(wrist.x, wrist.y),
    progress,
  };
}

function drawDebugZones(
  context: CanvasRenderingContext2D,
  transform: ReturnType<typeof viewportTransform>,
  width: number,
  height: number,
) {
  const engagedY = transform.point(
    0,
    interactionConfig.zones.engagedEnterY,
  ).y;
  const captureY = transform.point(
    0,
    interactionConfig.zones.captureEnterY,
  ).y;
  context.save();
  context.fillStyle = 'rgba(62, 174, 210, .035)';
  context.fillRect(0, 0, width, Math.max(0, engagedY));
  context.fillStyle = 'rgba(74, 211, 235, .055)';
  context.fillRect(0, engagedY, width, Math.max(0, captureY - engagedY));
  context.fillStyle = 'rgba(116, 240, 255, .075)';
  context.fillRect(0, captureY, width, Math.max(0, height - captureY));
  context.setLineDash([7, 9]);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255,255,255,.38)';
  [engagedY, captureY].forEach((y) => {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  });
  context.setLineDash([]);
  context.font = '600 11px Arial';
  context.textAlign = 'right';
  context.fillStyle = 'rgba(255,255,255,.7)';
  context.fillText('Z0 PASSERBY', width - 20, Math.max(18, engagedY - 12));
  context.fillText('Z1 ENGAGED', width - 20, captureY - 12);
  context.fillText(
    `Z2 CAPTURE · ≈${interactionConfig.zones.approximateForwardStepMeters.toFixed(1)}M STEP`,
    width - 20,
    Math.min(height - 18, captureY + 22),
  );
  context.restore();
}

export default function PerceptionHaloLayer({
  snapshot,
  videoRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef(snapshot);
  const firstRecognitionAtRef = useRef(new Map<string, number>());

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let animationFrame = 0;
    const draw = (time: number) => {
      animationFrame = window.requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const renderStarted = performance.now();
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        1280 / Math.max(1, bounds.width),
      );
      const pixelWidth = Math.max(1, Math.round(bounds.width * ratio));
      const pixelHeight = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const current = snapshotRef.current;
      const transform = viewportTransform(video, bounds.width, bounds.height);
      const readingById = new Map(
        current.zones.readings.map((reading) => [
          reading.personId,
          reading.stableZone,
        ]),
      );
      const activeIds = new Set(current.zones.activeIds);
      const visibleIds = new Set(
        current.frame?.people.map((person) => person.id) ?? [],
      );
      firstRecognitionAtRef.current.forEach((_recognizedAt, personId) => {
        if (!visibleIds.has(personId)) {
          firstRecognitionAtRef.current.delete(personId);
        }
      });
      const confirmationElapsed =
        current.gestureConfirmedAt === null
          ? null
          : Math.max(0, time - current.gestureConfirmedAt);
      const confirmationVisible =
        confirmationElapsed !== null &&
        confirmationElapsed <=
          interactionConfig.feedback.confirmationSweepMs +
            interactionConfig.feedback.confirmationFadeMs;
      const gestureVisualProgress = Math.max(
        current.stability.progress,
        clamp01(
          ((current.gesture?.matchScore ?? 0) -
            interactionConfig.raiseArmStartScore) /
            Math.max(
              0.01,
              interactionConfig.raiseArmConfirmScore -
                interactionConfig.raiseArmStartScore,
            ),
        ),
      );

      current.frame?.people.forEach((person) => {
        const zone = readingById.get(person.id);
        if (!zone) return;
        const engaged = zone !== 'PASSERBY';
        if (engaged && !firstRecognitionAtRef.current.has(person.id)) {
          firstRecognitionAtRef.current.set(person.id, time);
        }
        const isInitiator = current.initiatorId === person.id;
        const motion = isInitiator
          ? armMotionFor(
              person,
              current.gesture?.arm ?? null,
              transform,
              gestureVisualProgress,
            )
          : null;
        drawHalo(
          context,
          person,
          transform,
          time,
          activeIds.has(person.id),
          isInitiator,
          !engaged,
          motion,
          isInitiator && confirmationVisible ? confirmationElapsed : null,
        );

        const recognizedAt = firstRecognitionAtRef.current.get(person.id);
        if (engaged && recognizedAt !== undefined) {
          const recognitionProgress =
            (time - recognizedAt) /
            interactionConfig.feedback.firstRecognitionMs;
          if (recognitionProgress <= 1) {
            drawFirstRecognition(
              context,
              person,
              transform,
              recognitionProgress,
            );
          }
        }
      });

      const initiator = current.frame?.people.find(
        (person) => person.id === current.initiatorId,
      );
      if (
        initiator &&
        current.gesture?.arm &&
        (current.state === 'DIRECT' || confirmationVisible)
      ) {
        drawArm(
          context,
          initiator,
          current.gesture.arm,
          transform,
          gestureVisualProgress,
          confirmationVisible ? confirmationElapsed : null,
        );
      }

      if (
        new URLSearchParams(window.location.search).get('debug') === 'true'
      ) {
        drawDebugZones(context, transform, bounds.width, bounds.height);
      }
      recordRenderTiming('halo', performance.now() - renderStarted);
    };
    animationFrame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="perception-halo-layer"
      aria-hidden="true"
    />
  );
}
