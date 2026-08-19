/**
 * Timing and geometry for the wall finale.
 *
 * individual presence → collective convergence → AI perception → distilled
 * message. Every phase exists to carry one step of that sentence, not to show
 * off a photo-processing trick:
 *
 * - `freeze` belongs to the wall's own tiles, not to this module — they fade
 *   out on the opacity transition they already have. Nothing here animates
 *   during it.
 * - `converge`: portraits travel from their live wall positions into one tiny,
 *   edge-to-edge mosaic sampled from the real master KV headline.
 * - `pulse`: a sweep crosses the grid once. This is the perception — the room
 *   watching the system register everyone who is there.
 * - `retreat`: the video first frame begins as a magnified crop whose
 *   upper-right headline is aligned to the central photo headline, then the
 *   camera pulls back to its authored composition.
 * - `tagline`: the first frame holds until the video itself takes over.
 *
 * No card is ever re-cropped: `object-position` is fixed once and every
 * animated property here is a transform, opacity or blur value, never a crop.
 *
 * Kept free of the DOM so the whole sequence can be asserted without a
 * browser: a `requestAnimationFrame` loop does not run at all when the page is
 * not compositing, which makes an animation driven by one impossible to check
 * by inspecting the live document.
 */

export type FinalePhase = 'freeze' | 'converge' | 'pulse' | 'retreat' | 'tagline';

export interface FinaleTiming {
  freezeMs: number;
  convergeMs: number;
  pulseMs: number;
  retreatMs: number;
  taglineMs: number;
}

export const DEFAULT_FINALE_TIMING: FinaleTiming = {
  freezeMs: 700,
  // A clear, layered gathering rather than a single visual collapse.
  convergeMs: 5200,
  pulseMs: 1200,
  retreatMs: 1800,
  taglineMs: 1500,
};

export const FINALE_PHASE_ORDER: FinalePhase[] = [
  'freeze',
  'converge',
  'pulse',
  'retreat',
  'tagline',
];

const FINALE_NEXT: Record<FinalePhase, FinalePhase | null> = {
  freeze: 'converge',
  converge: 'pulse',
  pulse: 'retreat',
  retreat: 'tagline',
  tagline: null,
};

export function nextFinalePhase(phase: FinalePhase): FinalePhase | null {
  return FINALE_NEXT[phase];
}

export function finaleDurationMs(
  phase: FinalePhase,
  timing: FinaleTiming = DEFAULT_FINALE_TIMING,
): number {
  return timing[`${phase}Ms` as keyof FinaleTiming];
}

/** Sum of every phase, i.e. the instant the sentence is fully resolved. */
export function finaleTotalMs(timing: FinaleTiming = DEFAULT_FINALE_TIMING) {
  return FINALE_PHASE_ORDER.reduce(
    (sum, phase) => sum + finaleDurationMs(phase, timing),
    0,
  );
}

/** The elapsed time at which each phase begins, in `FINALE_PHASE_ORDER`. */
export function phaseStartMs(
  phase: FinalePhase,
  timing: FinaleTiming = DEFAULT_FINALE_TIMING,
) {
  let cursor = 0;
  for (const candidate of FINALE_PHASE_ORDER) {
    if (candidate === phase) return cursor;
    cursor += finaleDurationMs(candidate, timing);
  }
  return cursor;
}

/**
 * A bounded pool keeps the DOM safe when a very large venue wall is showing a
 * small photo collection. Available portraits may be reused, but the mapper
 * avoids immediate horizontal and vertical repeats.
 */
export const FINALE_CARD_COUNT = 2304;
/** Fallback field used only when the browser cannot rasterise the KV copy. */
const GRID_BOX = { width: 0.6, height: 0.54 };
const SCATTER_SPREAD = 0.47;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Zero velocity at both ends, so a portrait never launches or lands hard. */
function smootherStep(t: number) {
  const p = clamp(t, 0, 1);
  return p * p * p * (p * (p * 6 - 15) + 10);
}

/** Deterministic per-card jitter, so a replay looks identical to a rehearsal. */
function jitter(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Which portraits converge, as indices into the wall's entry list.
 *
 * Spread evenly across the whole event, so the grid represents the room
 * rather than whoever happened to be captured last. Unlike the flip this
 * replaced, there is no reuse: a grid cell is either a real portrait or it
 * isn't drawn, because a repeated face in a still grid is obvious in a way it
 * never was mid-turn.
 */
export function chooseFinalePhotos(
  total: number,
  count: number = FINALE_CARD_COUNT,
): number[] {
  if (total <= 0 || count <= 0) return [];
  const n = Math.min(count, total);
  if (n >= total) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: n }, (_, index) =>
    Math.min(Math.floor((index / n) * total), total - 1),
  );
}

export interface FinaleGrid {
  cols: number;
  rows: number;
}

/** A grid close to 16:10, sized to the card count with as little slack as possible. */
export function finaleGridFor(count: number): FinaleGrid {
  if (count <= 0) return { cols: 0, rows: 0 };
  const rows = Math.max(1, Math.round(Math.sqrt(count / 1.6)));
  const cols = Math.max(1, Math.ceil(count / rows));
  return { cols, rows };
}

export interface FinaleCardLayout {
  entryIndex: number;
  /** Where the card lands, normalised to the stage (0–1). */
  targetX: number;
  targetY: number;
  targetRotationDeg: number;
  targetColor?: string;
  /** Fallback start before converge. The live wall replaces this with the
   *  captured on-screen tile position whenever that portrait is visible. */
  startX: number;
  startY: number;
  /** Scale of the card at the captured wall position. Synthetic arrivals use
   *  a restrained half-size start; visible wall tiles can provide their real
   *  on-screen scale so the cross-fade does not jump. */
  startScale: number;
  /** Back, middle, or foreground wave. Far photos settle first; foreground
   * portraits keep their readable size longest before joining the letters. */
  depthTier: 0 | 1 | 2;
  /** Per-card timing within the normalised converge phase. */
  arrivalDelayUnit: number;
  arrivalDurationUnit: number;
}

export interface FinalePixelTarget {
  xUnit: number;
  yUnit: number;
  color?: string;
}

/**
 * The converge grid and each card's fallback scattered starting point.
 *
 * The grid is centred and evenly spaced; a small deterministic jitter on
 * position and rotation keeps it from reading as a spreadsheet. The scatter
 * uses a golden-angle spiral, which stays visually even at any card count
 * rather than clumping toward the centre.
 */
export function layoutFinaleCards(
  indices: number[],
  pixelTargets: FinalePixelTarget[] = [],
): FinaleCardLayout[] {
  const { cols, rows } = finaleGridFor(indices.length);
  if (cols === 0 || rows === 0) return [];

  const cellWidth = GRID_BOX.width / cols;
  const cellHeight = GRID_BOX.height / rows;
  const left = 0.5 - GRID_BOX.width / 2;
  const top = 0.5 - GRID_BOX.height / 2;
  const jitterX = cellWidth * 0.16;
  const jitterY = cellHeight * 0.16;

  return indices.map((entryIndex, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const fallbackTargetX =
      left + cellWidth * (column + 0.5) + (jitter(index, 1) - 0.5) * jitterX;
    const fallbackTargetY =
      top + cellHeight * (row + 0.5) + (jitter(index, 2) - 0.5) * jitterY;
    const pixelTarget = pixelTargets[index];
    const targetX = pixelTarget?.xUnit ?? fallbackTargetX;
    const targetY = pixelTarget?.yUnit ?? fallbackTargetY;

    const angle = index * GOLDEN_ANGLE + jitter(index, 3) * 1.4;
    const radius = Math.sqrt((index + 0.5) / indices.length) * SCATTER_SPREAD;
    const depthTier = Math.min(2, Math.floor(jitter(index, 8) * 3)) as 0 | 1 | 2;
    // Three visibly separate depth waves. A small inner offset avoids a
    // mechanical row launch while keeping the waves legible across the room.
    // Each visible launch is brief. Settled cards are already tiny text
    // pixels before the next depth wave becomes dense enough to cover them.
    const layerDelay = [0.02, 0.34, 0.68][depthTier];
    const layerDuration = [0.22, 0.2, 0.18][depthTier];

    return {
      entryIndex,
      targetX: clamp(targetX, 0.005, 0.995),
      targetY: clamp(targetY, 0.005, 0.995),
      targetRotationDeg: pixelTarget ? 0 : (jitter(index, 4) - 0.5) * 4,
      targetColor: pixelTarget?.color,
      startX: clamp(0.5 + Math.cos(angle) * radius, 0.02, 0.98),
      startY: clamp(0.5 + Math.sin(angle) * radius * 0.75, 0.06, 0.94),
      // Entries not currently visible in the river arrive from the open field
      // as larger cards as well, then contract into their image-pixel.
      startScale: 7 + jitter(index, 5) * 3,
      depthTier,
      // A little variation inside each layer avoids three visibly mechanical
      // batches while preserving a clear back-to-front progression.
      arrivalDelayUnit: layerDelay + jitter(index, 9) * 0.1,
      arrivalDurationUnit: layerDuration,
    };
  });
}

/** Width of one portrait in the edge-to-edge KV mosaic. */
export function finaleCardWidthPx(
  stageWidth: number,
  stageHeight: number,
  count: number,
): number {
  if (stageWidth <= 0 || stageHeight <= 0 || count <= 0) return 0;
  // The supplied panoramic KV uses a fine, flat headline mosaic. Size tiles
  // from the stage itself so repeated portraits touch without becoming cards.
  // A 2% overlap removes sub-pixel seams only; grid cells remain unique and
  // neighbouring photos never occupy one another's position.
  return Math.max(2, stageWidth / 360) * 1.01;
}

export interface FinaleCardFrame {
  entryIndex: number;
  xUnit: number;
  yUnit: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  blurPx: number;
  /** The pulse's response at this card: 0 at rest, 1 at the moment it is hit. */
  glow: number;
  /** Cross-fade from recognisable portrait into its sampled KV pixel. */
  pixelMix: number;
}

export interface FinaleFrame {
  cards: FinaleCardFrame[];
  /** The finale ground stays transparent during freeze so the live wall can
   *  visibly decelerate, then comes in behind the gathering cards. */
  fieldOpacity: number;
  /** Ambient background lift — rises through the pulse, settles for the type. */
  fieldHeat: number;
  /** The sweep's own position while it is on stage, else null. */
  pulseXUnit: number | null;
  /** Full-field flash that hides the handoff from photo points to clean type. */
  flashOpacity: number;
  taglineBlurPx: number;
  taglineOpacity: number;
  taglineScale: number;
  haloOpacity: number;
  /** Camera matrix over the fixed infinite mosaic. */
  cameraScale: number;
  cameraXUnit: number;
  cameraYUnit: number;
  /** Portion of the high-resolution KV revealed behind the scanning beam. */
  kvRevealXUnit: number;
  /** Opacity of the paused first frame of the closing video. */
  kvOpacity: number;
  /** Virtual-camera transform that returns the centred headline to its
   * authored top-right position in the video frame. */
  kvScale: number;
  kvTranslateXUnit: number;
  kvTranslateYUnit: number;
}

const PULSE_START_X = -0.18;
const PULSE_END_X = 1.18;
const PULSE_SIGMA = 0.1;
const CAMERA_START_SCALE = 8;
const CAMERA_FOCUS_X = 0.5;
const CAMERA_FOCUS_Y = 0.5;
// Measured from the supplied 4724 × 1313 first frame. The focus scale makes
// its authored Chinese headline the same apparent width as the photo headline
// at screen centre. Keeping this calibration explicit lets tests guard against
// exposed frame edges or a title that jumps during the hand-off.
export const FINALE_VIDEO_FRAME_GEOMETRY = {
  headlineCenterXUnit: 0.8768,
  headlineCenterYUnit: 0.1265,
  headlineWidthUnit: 0.1626,
  photoHeadlineCenterXUnit: 0.5,
  photoHeadlineCenterYUnit: 0.5,
  photoHeadlineWidthUnit: 0.735,
  focusScale: 4.52,
} as const;

function gaussian(distance: number, sigma: number) {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/** Everything the view needs at one instant, given elapsed time since freeze began. */
export function finaleFrameAt(
  timeMs: number,
  cards: FinaleCardLayout[],
  timing: FinaleTiming = DEFAULT_FINALE_TIMING,
): FinaleFrame {
  const convergeStart = phaseStartMs('converge', timing);
  const pulseStart = phaseStartMs('pulse', timing);
  const retreatStart = phaseStartMs('retreat', timing);
  const taglineStart = phaseStartMs('tagline', timing);

  const convergeP = clamp((timeMs - convergeStart) / timing.convergeMs, 0, 1);
  const pulseP = clamp((timeMs - pulseStart) / timing.pulseMs, 0, 1);
  const retreatP = clamp((timeMs - retreatStart) / timing.retreatMs, 0, 1);
  const sweepX =
    timeMs < pulseStart
      ? null
      : PULSE_START_X + (PULSE_END_X - PULSE_START_X) * pulseP;
  // First dissolve the clean first-frame title in underneath the photo title.
  // Only after that exact-position hand-off has settled does the camera move.
  const frameReveal = easeOutCubic(clamp(retreatP / 0.35, 0, 1));
  const pullbackEase = easeInOutCubic(
    clamp((retreatP - 0.42) / 0.58, 0, 1),
  );
  const photoDissolve = easeInOutCubic(
    clamp((retreatP - 0.04) / 0.38, 0, 1),
  );

  const cardFrames: FinaleCardFrame[] = cards.map((card) => {
    // The three depth layers enter back-to-front. Position starts first and
    // scale follows later, so a portrait drifts away from the wall before it
    // becomes a tiny letter pixel instead of instantly shooting inward.
    const localP = clamp(
      (convergeP - card.arrivalDelayUnit) / card.arrivalDurationUnit,
      0,
      1,
    );
    const positionEase = smootherStep(localP);
    const scaleDelay = 0.12 + card.depthTier * 0.04;
    const scaleEase = smootherStep(
      clamp((localP - scaleDelay) / (1 - scaleDelay), 0, 1),
    );
    const x = card.startX + (card.targetX - card.startX) * positionEase;
    const y = card.startY + (card.targetY - card.startY) * positionEase;
    const rotation = 0;
    const convergeOpacity =
      localP <= 0 ? 0 : easeOutCubic(clamp(localP / 0.18, 0, 1));
    // Do not reveal the pixel artwork while photos are still visibly large.
    // The dissolve begins only in the final 18% of the camera pullback, when a
    // portrait and one 64×36 KV pixel occupy effectively the same screen size.
    const pixelMix = 0;

    // Pulse: settled at the grid cell; only glow and a small scale bump travel
    // through, driven by distance from the sweep at this instant.
    const glow =
      sweepX === null || timeMs >= retreatStart
        ? 0
        : gaussian(card.targetX - sweepX, PULSE_SIGMA);
    return {
      entryIndex: card.entryIndex,
      xUnit: x,
      yUnit: y,
      scale: card.startScale + (1 - card.startScale) * scaleEase,
      rotationDeg: rotation,
      opacity: convergeOpacity * (1 - photoDissolve),
      blurPx: 0,
      glow: 0,
      pixelMix,
    };
  });

  // Ambient lift: rises into the pulse, eases back down as the type takes over.
  const heatRise = clamp(
    (timeMs - convergeStart) / (pulseStart + timing.pulseMs - convergeStart),
    0,
    1,
  );
  const heatFall = clamp((timeMs - retreatStart) / (timing.retreatMs + timing.taglineMs), 0, 1);
  const fieldHeat = clamp(0.4 + heatRise * 0.45 - heatFall * 0.3, 0.1, 0.85);
  const fieldOpacity = easeOutCubic(
    clamp((timeMs - convergeStart) / (timing.convergeMs * 0.32), 0, 1),
  );

  // The shrink now belongs to each real photo. Keeping the shared stage at
  // scale 1 avoids multiplying that shrink and producing giant, clipped cards.
  const cameraScale = 1;
  const kvScale =
    FINALE_VIDEO_FRAME_GEOMETRY.focusScale +
    (1 - FINALE_VIDEO_FRAME_GEOMETRY.focusScale) * pullbackEase;
  const focusTranslateX =
    FINALE_VIDEO_FRAME_GEOMETRY.photoHeadlineCenterXUnit -
    FINALE_VIDEO_FRAME_GEOMETRY.headlineCenterXUnit *
      FINALE_VIDEO_FRAME_GEOMETRY.focusScale;
  const focusTranslateY =
    FINALE_VIDEO_FRAME_GEOMETRY.photoHeadlineCenterYUnit -
    FINALE_VIDEO_FRAME_GEOMETRY.headlineCenterYUnit *
      FINALE_VIDEO_FRAME_GEOMETRY.focusScale;
  return {
    cards: cardFrames,
    fieldOpacity,
    fieldHeat,
    pulseXUnit: null,
    flashOpacity: 0,
    taglineBlurPx: 0,
    // The full-resolution KV dissolves over the complete scan duration. The
    // beam is only an accent; it no longer acts as a hard reveal boundary.
    // Hold the completed pixel KV briefly so it reads as an intentional frame,
    // then dissolve gently to the master rather than changing immediately.
    taglineOpacity: frameReveal,
    taglineScale: 1,
    haloOpacity: 0,
    cameraScale,
    cameraXUnit: 0,
    cameraYUnit: 0,
    kvRevealXUnit: 1,
    kvOpacity: frameReveal,
    kvScale,
    kvTranslateXUnit: focusTranslateX * (1 - pullbackEase),
    kvTranslateYUnit: focusTranslateY * (1 - pullbackEase),
  };
}
