import { wallConfig } from '../config/wallConfig';

export interface SloganTarget {
  x: number;
  y: number;
}

export interface TargetRequirement {
  /** Ink area of the phrase once mapped onto the wall, in layout pixels². */
  inkAreaPx: number;
  /** Median stroke width of the phrase on the wall, in layout pixels. */
  strokePx: number;
  /** Largest tile that still reads as part of a stroke rather than a blob. */
  maxTilePx: number;
  /** Fewest photos that can draw this phrase legibly. */
  minPhotos: number;
}

export interface AssemblePlan extends TargetRequirement {
  primary: string;
  secondary: string;
  targets: SloganTarget[];
  tileSizePx: number;
}

export type AssembleDecision =
  | { ready: true; plan: AssemblePlan }
  | { ready: false; minimumPhotos: number };

/**
 * Picks evenly spread points out of a rasterised glyph mask.
 *
 * Kept free of the DOM so the spread can be tested. Targets are returned in
 * scan order rather than shuffled, so a caller that hands them out in arrival
 * order has the wall write the phrase in the order the photos were taken.
 */
export function pickSloganTargets(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  count: number,
  step: number = wallConfig.assemble.sampleStep,
  threshold: number = wallConfig.assemble.alphaThreshold,
): SloganTarget[] {
  if (count <= 0 || width <= 0 || height <= 0) return [];
  const covered: SloganTarget[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (alpha[y * width + x] > threshold) {
        covered.push({ x: x / width, y: y / height });
      }
    }
  }
  if (covered.length === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const position = Math.floor((index / count) * covered.length);
    return covered[Math.min(position, covered.length - 1)];
  });
}

export function inkPixelCount(
  alpha: ArrayLike<number>,
  threshold: number = wallConfig.assemble.alphaThreshold,
) {
  let ink = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] > threshold) ink += 1;
  }
  return ink;
}

/**
 * Median horizontal run of ink, which is how thick the strokes are. This is the
 * number that decides legibility: once a tile is wider than a stroke, the shape
 * of the character is gone.
 */
export function medianRunLength(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number = wallConfig.assemble.alphaThreshold,
) {
  const runs: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let run = 0;
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > threshold) {
        run += 1;
      } else {
        if (run > 0) runs.push(run);
        run = 0;
      }
    }
    if (run > 0) runs.push(run);
  }
  if (runs.length === 0) return 0;
  runs.sort((left, right) => left - right);
  return runs[Math.floor(runs.length / 2)];
}

export function targetRequirement(
  inkPx: number,
  strokeRunPx: number,
  sampleWidth: number,
  sampleHeight: number,
  layoutWidth: number,
  layoutHeight: number,
  strokeTileRatio: number = wallConfig.assemble.strokeTileRatio,
): TargetRequirement {
  const scaleX = layoutWidth / Math.max(1, sampleWidth);
  const scaleY = layoutHeight / Math.max(1, sampleHeight);
  const inkAreaPx = inkPx * scaleX * scaleY;
  const strokePx = strokeRunPx * scaleX;
  const maxTilePx = strokePx * strokeTileRatio;
  return {
    inkAreaPx,
    strokePx,
    maxTilePx,
    minPhotos:
      maxTilePx <= 0 ? Number.POSITIVE_INFINITY : Math.ceil(inkAreaPx / (maxTilePx * maxTilePx)),
  };
}

/** Enough tiles to cover the ink, never wider than a stroke. */
export function tileSizeFor(
  inkAreaPx: number,
  photoCount: number,
  maxTilePx: number,
  minTilePx: number = wallConfig.assemble.minTilePx,
) {
  if (photoCount <= 0) return minTilePx;
  const even = Math.sqrt(inkAreaPx / photoCount);
  return Math.max(minTilePx, Math.min(maxTilePx, even));
}

function rasterise(primary: string, secondary: string) {
  const { sampleWidth, sampleHeight } = wallConfig.assemble;
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.clearRect(0, 0, sampleWidth, sampleHeight);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const primarySize = Math.min(
    120,
    Math.floor(sampleWidth / Math.max(primary.length * 0.85, 6)),
  );
  context.font = `900 ${primarySize}px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  context.fillText(primary, sampleWidth / 2, sampleHeight * (secondary ? 0.42 : 0.5));

  if (secondary) {
    const secondarySize = Math.min(
      30,
      Math.floor(sampleWidth / Math.max(secondary.length * 0.55, 8)),
    );
    context.font = `600 ${secondarySize}px Inter, "Helvetica Neue", sans-serif`;
    context.fillText(secondary, sampleWidth / 2, sampleHeight * 0.63);
  }

  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const alpha = new Uint8ClampedArray(data.length / 4);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = data[index * 4 + 3];
  }
  return alpha;
}

/**
 * Chooses the richest phrase the room has earned.
 *
 * Everything is measured from a fresh raster rather than read from a table, so
 * a venue machine that substitutes a different CJK font gets its own numbers.
 */
export function planAssembly(
  photoCount: number,
  layoutWidth: number,
  layoutHeight: number,
): AssembleDecision {
  const { sampleWidth, sampleHeight, targets } = wallConfig.assemble;
  let simplestMinimum = Number.POSITIVE_INFINITY;

  for (const candidate of targets) {
    const alpha = rasterise(candidate.primary, candidate.secondary);
    if (!alpha) continue;
    const requirement = targetRequirement(
      inkPixelCount(alpha),
      medianRunLength(alpha, sampleWidth, sampleHeight),
      sampleWidth,
      sampleHeight,
      layoutWidth,
      layoutHeight,
    );
    simplestMinimum = Math.min(simplestMinimum, requirement.minPhotos);
    if (photoCount < requirement.minPhotos) continue;

    const points = pickSloganTargets(
      alpha,
      sampleWidth,
      sampleHeight,
      photoCount,
    );
    if (points.length === 0) continue;
    return {
      ready: true,
      plan: {
        ...requirement,
        primary: candidate.primary,
        secondary: candidate.secondary,
        targets: points,
        tileSizePx: tileSizeFor(
          requirement.inkAreaPx,
          photoCount,
          requirement.maxTilePx,
        ),
      },
    };
  }

  return {
    ready: false,
    minimumPhotos: Number.isFinite(simplestMinimum) ? simplestMinimum : 0,
  };
}
