import type { PoseTrace, PoseTracePoint } from '../types';

export interface PoseFigure {
  bones: [PoseTracePoint, PoseTracePoint][];
  joints: PoseTracePoint[];
  hull: PoseTracePoint[];
}

const BONES: [string, string][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

/**
 * Refits a stored pose into the unit box of one wall cell.
 *
 * The stored trace is normalised to its own portrait, so overlaying it on a
 * `object-fit: cover` thumbnail would put most of the body outside a 106×83
 * cell. Refitting to the pose's own extents keeps the whole figure readable at
 * cell size; it is a legible reduction of the recorded pose, not a registered
 * overlay of it.
 */
export function fitPoseToCell(
  trace: PoseTrace,
  minScore = 0.2,
  padding = 0.12,
): PoseFigure | null {
  const points = new Map<string, PoseTracePoint>();
  trace.keypoints.forEach((keypoint) => {
    if (keypoint.score >= minScore) {
      points.set(keypoint.name, { x: keypoint.x, y: keypoint.y });
    }
  });
  if (points.size < 2) return null;

  const all = [...points.values()];
  const xs = all.map((point) => point.x);
  const ys = all.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY);
  if (span <= 0) return null;

  const usable = 1 - padding * 2;
  const scale = usable / span;
  const offsetX = padding + (usable - (maxX - minX) * scale) / 2;
  const offsetY = padding + (usable - (maxY - minY) * scale) / 2;
  const project = (point: PoseTracePoint): PoseTracePoint => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale,
  });

  const bones = BONES.flatMap(([from, to]) => {
    const start = points.get(from);
    const end = points.get(to);
    if (!start || !end) return [];
    return [[project(start), project(end)] as [PoseTracePoint, PoseTracePoint]];
  });

  return {
    bones,
    joints: all.map(project),
    hull: trace.hullPoints.map(project),
  };
}

/** The initiator's figure if the capture had one, otherwise the first usable. */
export function leadFigure(traces: PoseTrace[]): PoseFigure | null {
  const ordered = [...traces].sort(
    (left, right) => Number(right.isInitiator) - Number(left.isInitiator),
  );
  for (const trace of ordered) {
    const figure = fitPoseToCell(trace);
    if (figure) return figure;
  }
  return null;
}
