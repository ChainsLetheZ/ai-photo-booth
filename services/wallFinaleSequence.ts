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
 * - `converge`: portraits are already locked into one giant mosaic. A virtual
 *   camera travels across it and pulls back until the mosaic reads as the
 *   sampled pixels of the real master KV. Individual photos never fly around.
 * - `pulse`: a sweep crosses the grid once. This is the perception — the room
 *   watching the system register everyone who is there.
 * - `retreat`: the KV pixels contract behind a flash.
 * - `tagline`: the high-resolution master KV resolves from a blur and holds until the
 *   operator takes it down.
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
  convergeMs: 1400,
  pulseMs: 1000,
  retreatMs: 1000,
  taglineMs: 1300,
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
 * 48 × 27 portrait pixels: fine enough for a 16:9 KV to read as an image on a
 * large display. Available portraits repeat across the fixed mosaic.
 */
export const FINALE_CARD_COUNT = 1296;
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
  const { cols, rows } = finaleGridFor(count);
  const widthFromColumn = stageWidth / cols;
  // Fill every KV column; portrait tiles overlap slightly vertically so no
  // dark seams appear between the sampled colour pixels.
  return widthFromColumn * 1.01;
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
}

const PULSE_START_X = -0.18;
const PULSE_END_X = 1.18;
const PULSE_SIGMA = 0.1;
const CAMERA_START_SCALE = 8;
const CAMERA_FOCUS_X = 0.38;
const CAMERA_FOCUS_Y = 0.62;

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
  const taglineP = clamp((timeMs - taglineStart) / timing.taglineMs, 0, 1);

  const convergeEase = easeOutCubic(convergeP);
  const retreatEase = easeOutCubic(retreatP);
  const sweepX =
    timeMs < pulseStart
      ? null
      : PULSE_START_X + (PULSE_END_X - PULSE_START_X) * pulseP;

  const cardFrames: FinaleCardFrame[] = cards.map((card) => {
    // Every tile is fixed in the master mosaic. Only the shared camera moves.
    const x = card.targetX;
    const y = card.targetY;
    const rotation = 0;
    const convergeOpacity = convergeP <= 0 ? 0 : easeOutCubic(clamp(convergeP * 1.4, 0, 1));
    const pixelMix = easeInOutCubic(clamp((convergeP - 0.58) / 0.42, 0, 1));

    // Pulse: settled at the grid cell; only glow and a small scale bump travel
    // through, driven by distance from the sweep at this instant.
    const glow =
      sweepX === null || timeMs >= retreatStart
        ? 0
        : gaussian(card.targetX - sweepX, PULSE_SIGMA);
    const pulseScale = 1 + glow * 0.035;

    // The sampled KV pixels contract and disappear behind the flash; the final
    // held frame is the clean high-resolution master KV.
    const retreatX = card.targetX;
    const retreatY = card.targetY;
    const retreatScale = 1 - retreatEase * 0.78;
    const retreatOpacity =
      1 - easeInOutCubic(clamp((retreatP - 0.42) / 0.58, 0, 1));
    const retreatBlur = retreatEase * 3;

    const inRetreatOrLater = timeMs >= retreatStart;
    return {
      entryIndex: card.entryIndex,
      xUnit: inRetreatOrLater ? retreatX : x,
      yUnit: inRetreatOrLater ? retreatY : y,
      scale: inRetreatOrLater ? retreatScale : pulseScale,
      rotationDeg: rotation,
      opacity: inRetreatOrLater ? retreatOpacity : convergeOpacity,
      blurPx: inRetreatOrLater ? retreatBlur : 0,
      glow,
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

  const taglineEase = easeOutCubic(clamp((taglineP - 0.08) / 0.72, 0, 1));
  const cameraScale = CAMERA_START_SCALE + (1 - CAMERA_START_SCALE) * convergeEase;
  const cameraStartX = 0.5 - CAMERA_START_SCALE * CAMERA_FOCUS_X;
  const cameraStartY = 0.5 - CAMERA_START_SCALE * CAMERA_FOCUS_Y;
  return {
    cards: cardFrames,
    fieldOpacity,
    fieldHeat,
    pulseXUnit:
      sweepX !== null && timeMs < retreatStart ? clamp(sweepX, 0, 1) : null,
    flashOpacity: 0,
    taglineBlurPx: 0,
    // The full-resolution KV dissolves over the complete scan duration. The
    // beam is only an accent; it no longer acts as a hard reveal boundary.
    taglineOpacity: easeInOutCubic(pulseP),
    taglineScale: 1,
    haloOpacity: taglineEase * 0.32,
    cameraScale,
    cameraXUnit: cameraStartX * (1 - convergeEase),
    cameraYUnit: cameraStartY * (1 - convergeEase),
    kvRevealXUnit: 1,
  };
}
