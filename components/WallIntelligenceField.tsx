import React from 'react';

export type WallIntelligencePhase =
  | 'arriving'
  | 'perception'
  | 'settling'
  | 'integrated';

export interface WallSignalPoint {
  id: string;
  x: number;
  y: number;
}

interface WallIntelligenceFieldProps {
  width: number;
  height: number;
  focus: WallSignalPoint;
  nodes: WallSignalPoint[];
  phase: WallIntelligencePhase;
  energy: string;
}

/**
 * The joining portrait is briefly treated as a signal rather than another
 * tile: nearby portraits form a small neural neighbourhood, the wall scans
 * the new pose, then the network contracts into the register.
 */
export default function WallIntelligenceField({
  width,
  height,
  focus,
  nodes,
  phase,
  energy,
}: WallIntelligenceFieldProps) {
  return (
    <div
      className={`wall-ai-field is-${phase}`}
      style={{ '--wall-ai-energy': energy } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <radialGradient id="wall-ai-focus-gradient">
            <stop offset="0" stopColor="white" stopOpacity="0.92" />
            <stop offset="0.26" stopColor={energy} stopOpacity="0.72" />
            <stop offset="1" stopColor={energy} stopOpacity="0" />
          </radialGradient>
          <filter id="wall-ai-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="wall-ai-links">
          {nodes.map((node, index) => (
            <line
              key={node.id}
              x1={focus.x}
              y1={focus.y}
              x2={node.x}
              y2={node.y}
              pathLength="1"
              style={{ '--wall-link-order': index } as React.CSSProperties}
            />
          ))}
        </g>

        <g className="wall-ai-nodes">
          {nodes.map((node, index) => (
            <g
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              style={{ '--wall-link-order': index } as React.CSSProperties}
            >
              <circle className="wall-ai-node-halo" r="11" />
              <circle className="wall-ai-node-core" r="2.8" />
            </g>
          ))}
        </g>

        <g
          className="wall-ai-focus"
          transform={`translate(${focus.x} ${focus.y})`}
          filter="url(#wall-ai-glow)"
        >
          <circle className="wall-ai-focus-wash" r="92" fill="url(#wall-ai-focus-gradient)" />
          <circle className="wall-ai-focus-ring ring-one" r="51" />
          <circle className="wall-ai-focus-ring ring-two" r="68" />
          <circle className="wall-ai-focus-core" r="4" />
        </g>
      </svg>

      <i
        className="wall-ai-scan"
        style={{ '--wall-ai-focus-y': `${focus.y}px` } as React.CSSProperties}
      />
    </div>
  );
}
