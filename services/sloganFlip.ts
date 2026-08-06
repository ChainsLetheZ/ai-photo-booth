/**
 * Timing and geometry for movement four of the wall finale.
 *
 * Kept free of the DOM so the whole sequence can be asserted without a browser:
 * a `requestAnimationFrame` loop does not run at all when the page is not
 * compositing, which makes an animation driven by one impossible to check by
 * inspecting the live document.
 *
 * The look this is aiming at is a riffled stack seen from inside it, not a card
 * turning on a stage. Four things carry that and all four are computed here:
 * pages large enough to overrun the frame, several depths turning at once, a
 * camera that never stops pushing in, and blur that tracks how fast a page is
 * actually moving.
 */

/** Depth lanes, in pixels along the z axis. Perspective does the sizing. */
export const LANE_DEPTHS_PX = [-460, -120, 210];
export const LANE_COUNT = LANE_DEPTHS_PX.length;

/**
 * Pages in the air at once peak well above `LIFE_RATIO`, because the minimum
 * life clamps the fastest pages open for longer than their own cadence. The
 * pool is sized above that peak with headroom; the test measures the real peak
 * and fails if this stops clearing it.
 */
export const POOL_SIZE = 14;
export const FLIP_COUNT = 40;
/** The most recent captures always land last, right before the lock-up. */
export const RECENT_TAIL = 5;

export interface FlipTiming {
  openMs: number;
  flipMs: number;
  lockMs: number;
}

export const DEFAULT_TIMING: FlipTiming = {
  openMs: 420,
  flipMs: 2200,
  lockMs: 700,
};

export function totalMs(timing: FlipTiming = DEFAULT_TIMING) {
  return timing.openMs + timing.flipMs + timing.lockMs;
}

export const SLOGAN_FLIP_TOTAL_MS = totalMs();

const FIRST_CADENCE_MS = 190;
const LAST_CADENCE_MS = 34;
/** How long a page lives relative to the gap behind it — this sets the stack. */
const LIFE_RATIO = 3.2;
const MIN_LIFE_MS = 240;
const MAX_LIFE_MS = 620;

const SWEEP_DEG = 200;
const MAX_BLUR_PX = 17;

export interface Flip {
  entryIndex: number;
  startMs: number;
  lifeMs: number;
  slot: number;
  lane: number;
}

export interface CardFrame {
  entryIndex: number;
  lane: number;
  /** Degrees about the spine: negative is rising, positive is leaving. */
  angleDeg: number;
  /** A few degrees of roll so the stack is never a perfect deck. */
  rollDeg: number;
  offsetXPercent: number;
  opacity: number;
  depthPx: number;
  scale: number;
  /** Leading-edge light, strongest when the page is steep. */
  rim: number;
  /** Tracks real angular speed, so only the fast steep pages smear. */
  blurPx: number;
}

export interface FlipFrame {
  cards: Map<number, CardFrame>;
  /** The dolly. It never stops, including through the lock-up. */
  cameraScale: number;
  cameraRollDeg: number;
  spineScale: number;
  spineOpacity: number;
  heat: number;
  lift: number;
  /** Held near zero while the pages run, so nothing crops the immersion. */
  vignette: number;
  flash: number;
  typeOpacity: number;
  typeScale: number;
  sweepXPercent: number;
  sweepOpacity: number;
}

export function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Deterministic per-page jitter, so a replay looks identical to a rehearsal. */
function jitter(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Which portraits turn, as indices into the wall's entry list.
 *
 * Spread evenly so the run represents the whole event, with the newest captures
 * held back for the end — the people still standing by the wall see themselves
 * in the last beat before the sentence lands.
 *
 * The page count never falls with the portrait count. A room that has produced
 * twelve photos reuses them rather than stretching twelve pages across the
 * window, because a finale that runs at half speed in the morning and full
 * speed at night is a different finale. Repeats sit far enough apart that the
 * same face is never in the air twice.
 */
export function chooseFlipIndices(total: number, count = FLIP_COUNT): number[] {
  if (total <= 0 || count <= 0) return [];
  const tailLength = Math.min(RECENT_TAIL, total, count);
  const tail = Array.from(
    { length: tailLength },
    (_, index) => total - tailLength + index,
  );
  const spreadCount = count - tailLength;
  if (spreadCount <= 0) return tail;

  // With enough portraits to fill the run outright, the spread walks the ones
  // not already reserved for the tail. When it has to repeat, it cycles through
  // everyone instead: a shorter cycle than the number of pages in the air would
  // put the same face on screen twice.
  const reservoir = total - tailLength;
  const spread = Array.from({ length: spreadCount }, (_, index) =>
    reservoir >= spreadCount
      ? Math.min(Math.floor((index / spreadCount) * reservoir), reservoir - 1)
      : index % total,
  );
  return [...spread, ...tail];
}

/**
 * Cadences fall geometrically — this is the acceleration the whole movement
 * rides on — then get scaled so the run fills its window exactly, however many
 * portraits the room produced.
 */
export function scheduleFlips(
  indices: number[],
  timing: FlipTiming = DEFAULT_TIMING,
): Flip[] {
  if (indices.length === 0) return [];
  const count = indices.length;
  const ratio =
    count > 1
      ? Math.pow(LAST_CADENCE_MS / FIRST_CADENCE_MS, 1 / (count - 1))
      : 1;
  const raw = Array.from(
    { length: count },
    (_, index) => FIRST_CADENCE_MS * Math.pow(ratio, index),
  );
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = timing.flipMs / rawTotal;

  let cursor = timing.openMs;
  return indices.map((entryIndex, index) => {
    const flip: Flip = {
      entryIndex,
      startMs: cursor,
      lifeMs: clamp(raw[index] * scale * LIFE_RATIO, MIN_LIFE_MS, MAX_LIFE_MS),
      slot: index % POOL_SIZE,
      // Neighbouring pages never share a depth, so the stack always reads as
      // a stack rather than a queue.
      lane: index % LANE_COUNT,
    };
    cursor += raw[index] * scale;
    return flip;
  });
}

/** Everything the view needs at one instant. */
export function flipFrameAt(
  timeMs: number,
  flips: Flip[],
  timing: FlipTiming = DEFAULT_TIMING,
): FlipFrame {
  const { openMs, flipMs, lockMs } = timing;
  const openProgress = clamp(timeMs / openMs, 0, 1);
  const flipProgress = clamp((timeMs - openMs) / flipMs, 0, 1);
  const lockProgress = clamp((timeMs - openMs - flipMs) / lockMs, 0, 1);
  const typeIn = easeOutCubic(clamp((lockProgress - 0.16) / 0.84, 0, 1));
  const overall = clamp(timeMs / totalMs(timing), 0, 1);

  const cards = new Map<number, CardFrame>();
  for (const flip of flips) {
    const p = (timeMs - flip.startMs) / flip.lifeMs;
    if (p < 0 || p > 1) continue;
    const angleDeg = -SWEEP_DEG / 2 + SWEEP_DEG * p;
    const arc = Math.sin(Math.PI * p);
    const steep = Math.abs(angleDeg) / (SWEEP_DEG / 2);
    // A page that lives briefly is turning faster, so it smears more.
    const speed = MIN_LIFE_MS / flip.lifeMs;
    cards.set(flip.slot, {
      entryIndex: flip.entryIndex,
      lane: flip.lane,
      angleDeg,
      rollDeg: (jitter(flip.entryIndex, 1) - 0.5) * 7,
      offsetXPercent: (jitter(flip.entryIndex, 2) - 0.5) * 13,
      opacity: clamp(arc * 2.4, 0, 1),
      depthPx: LANE_DEPTHS_PX[flip.lane] + arc * 120,
      scale: 0.96 + arc * 0.1,
      rim: Math.pow(steep, 1.5) * 0.95,
      blurPx: clamp(speed * Math.pow(steep, 1.3) * MAX_BLUR_PX, 0, MAX_BLUR_PX),
    });
  }

  return {
    cards,
    // One continuous push from the first frame to the last. Stopping it at the
    // lock-up is what would make the finale feel like a slide.
    cameraScale: 1 + easeInOutCubic(overall) * 0.46,
    cameraRollDeg: -1.6 + overall * 3.2,
    spineScale: 0.12 + easeOutCubic(openProgress) * 0.88,
    spineOpacity: openProgress,
    // Speed becomes light.
    heat: 0.6 + flipProgress * 0.85,
    lift: 0.52 + flipProgress * 0.7,
    // Pulled almost fully open while pages run, closed again for the sentence.
    vignette: 0.16 + (1 - flipProgress) * 0.34 + typeIn * 0.5,
    flash: Math.sin(Math.PI * Math.min(lockProgress * 1.3, 1)) * 0.95,
    typeOpacity: typeIn,
    // The sentence settles down to size rather than growing into place.
    typeScale: 1.18 - typeIn * 0.18,
    sweepXPercent: -120 + typeIn * 240,
    sweepOpacity: Math.sin(Math.PI * typeIn) * 0.85,
  };
}
