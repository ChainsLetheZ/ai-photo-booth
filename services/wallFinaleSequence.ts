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
 * - `converge`: portraits arrive from a scatter and settle into a grid, full
 *   frame, unmodified crop. This is individual presence becoming a collective.
 * - `pulse`: a sweep crosses the grid once. This is the perception — the room
 *   watching the system register everyone who is there.
 * - `retreat`: the grid gives up the frame.
 * - `tagline`: the distilled message resolves from a blur and holds until the
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

export const FINALE_CARD_COUNT = 28;
/** How much of the stage the converged grid occupies, centred. */
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
  /** Fallback start before converge. The live wall replaces this with the
   *  captured on-screen tile position whenever that portrait is visible. */
  startX: number;
  startY: number;
  /** Scale of the card at the captured wall position. Synthetic arrivals use
   *  a restrained half-size start; visible wall tiles can provide their real
   *  on-screen scale so the cross-fade does not jump. */
  startScale: number;
}

/**
 * The converge grid and each card's fallback scattered starting point.
 *
 * The grid is centred and evenly spaced; a small deterministic jitter on
 * position and rotation keeps it from reading as a spreadsheet. The scatter
 * uses a golden-angle spiral, which stays visually even at any card count
 * rather than clumping toward the centre.
 */
export function layoutFinaleCards(indices: number[]): FinaleCardLayout[] {
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
    const targetX =
      left + cellWidth * (column + 0.5) + (jitter(index, 1) - 0.5) * jitterX;
    const targetY =
      top + cellHeight * (row + 0.5) + (jitter(index, 2) - 0.5) * jitterY;

    const angle = index * GOLDEN_ANGLE + jitter(index, 3) * 1.4;
    const radius = Math.sqrt((index + 0.5) / indices.length) * SCATTER_SPREAD;

    return {
      entryIndex,
      targetX: clamp(targetX, 0.03, 0.97),
      targetY: clamp(targetY, 0.08, 0.92),
      targetRotationDeg: (jitter(index, 4) - 0.5) * 4,
      startX: clamp(0.5 + Math.cos(angle) * radius, 0.02, 0.98),
      startY: clamp(0.5 + Math.sin(angle) * radius * 0.75, 0.06, 0.94),
      startScale: 0.52,
    };
  });
}

/**
 * Width of a 4:3 card that fits inside its grid cell with a real gap on every
 * side. The calculation is shared by the live wall and the finale renderer so
 * a captured tile can be expressed as a scale without changing its crop.
 */
export function finaleCardWidthPx(
  stageWidth: number,
  stageHeight: number,
  count: number,
): number {
  if (stageWidth <= 0 || stageHeight <= 0 || count <= 0) return 0;
  const { cols, rows } = finaleGridFor(count);
  const gapFactor = 0.86;
  const widthFromColumn = (stageWidth * GRID_BOX.width * gapFactor) / cols;
  const widthFromRow =
    ((stageHeight * GRID_BOX.height * gapFactor) / rows) * (4 / 3);
  return Math.min(widthFromColumn, widthFromRow);
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
  taglineBlurPx: number;
  taglineOpacity: number;
  taglineScale: number;
  haloOpacity: number;
}

const PULSE_START_X = -0.18;
const PULSE_END_X = 1.18;
const PULSE_SIGMA = 0.1;

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
    // Converge: from the scatter to the grid cell, fading and growing in.
    const x = card.startX + (card.targetX - card.startX) * convergeEase;
    const y = card.startY + (card.targetY - card.startY) * convergeEase;
    const rotation = card.targetRotationDeg * convergeEase;
    const convergeScale = card.startScale + (1 - card.startScale) * convergeEase;
    const convergeOpacity = convergeP <= 0 ? 0 : easeOutCubic(clamp(convergeP * 1.4, 0, 1));

    // Pulse: settled at the grid cell; only glow and a small scale bump travel
    // through, driven by distance from the sweep at this instant.
    const glow =
      sweepX === null || timeMs >= retreatStart
        ? 0
        : gaussian(card.targetX - sweepX, PULSE_SIGMA);
    const pulseScale = 1 + glow * 0.035;

    // Retreat: the grid gives up the frame together.
    const retreatX = card.targetX + (0.5 - card.targetX) * retreatEase * 0.06;
    const retreatY = card.targetY + (0.5 - card.targetY) * retreatEase * 0.06;
    const retreatScale = 1 - retreatEase * 0.18;
    const retreatOpacity = 1 - retreatEase;
    const retreatBlur = retreatEase * 6;

    const inRetreatOrLater = timeMs >= retreatStart;
    return {
      entryIndex: card.entryIndex,
      xUnit: inRetreatOrLater ? retreatX : x,
      yUnit: inRetreatOrLater ? retreatY : y,
      scale: inRetreatOrLater ? retreatScale : convergeScale * pulseScale,
      rotationDeg: rotation,
      opacity: inRetreatOrLater ? retreatOpacity : convergeOpacity,
      blurPx: inRetreatOrLater ? retreatBlur : 0,
      glow,
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

  const taglineEase = easeOutCubic(clamp((taglineP - 0.1) / 0.9, 0, 1));
  return {
    cards: cardFrames,
    fieldOpacity,
    fieldHeat,
    pulseXUnit:
      sweepX !== null && timeMs < retreatStart ? clamp(sweepX, 0, 1) : null,
    taglineBlurPx: 14 * (1 - taglineEase),
    taglineOpacity: taglineEase,
    // The sentence settles down to size rather than growing into place.
    taglineScale: 1.08 - taglineEase * 0.08,
    haloOpacity: taglineEase * 0.32,
  };
}
