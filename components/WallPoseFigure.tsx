import React from 'react';
import type { PoseFigure } from '../services/wallPoseFigure';

/**
 * The skeleton the wall shows before it shows the photo — what the booth
 * actually perceived, drawn from the pose stored with the entry.
 */
export default function WallPoseFigure({
  figure,
  personCount,
}: {
  figure: PoseFigure;
  personCount: number;
}) {
  return (
    <svg
      className="wall-pose-figure"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {figure.hull.length >= 3 && (
        <polygon
          className="wall-pose-hull"
          points={figure.hull.map((point) => `${point.x},${point.y}`).join(' ')}
        />
      )}
      {figure.bones.map(([start, end], index) => (
        <line
          key={index}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {figure.joints.map((joint, index) => (
        <circle key={index} cx={joint.x} cy={joint.y} r={0.022} />
      ))}
      {personCount > 1 && (
        <text className="wall-pose-count" x={0.5} y={0.97}>
          {personCount}
        </text>
      )}
    </svg>
  );
}
