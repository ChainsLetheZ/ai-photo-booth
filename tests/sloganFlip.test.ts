import assert from 'node:assert/strict';
import {
  chooseFlipIndices,
  DEFAULT_TIMING,
  flipFrameAt,
  FLIP_COUNT,
  LANE_COUNT,
  POOL_SIZE,
  RECENT_TAIL,
  scheduleFlips,
  SLOGAN_FLIP_TOTAL_MS,
  totalMs,
} from '../services/sloganFlip';

const { openMs: OPEN_MS, flipMs: FLIP_MS, lockMs: LOCK_MS } = DEFAULT_TIMING;

// --- which portraits turn -------------------------------------------------

assert.deepEqual(chooseFlipIndices(0), []);
assert.equal(chooseFlipIndices(FLIP_COUNT).length, FLIP_COUNT);

// The page count must not fall with the portrait count: a morning wall with a
// dozen photos has to run at the same rhythm as a full one at night.
for (const total of [1, 3, 12, 25, FLIP_COUNT, 200]) {
  assert.equal(
    chooseFlipIndices(total).length,
    FLIP_COUNT,
    `a wall of ${total} portraits should still fill ${FLIP_COUNT} pages`,
  );
  chooseFlipIndices(total).forEach((index) => {
    assert.ok(index >= 0 && index < total, `index ${index} outside 0..${total}`);
  });
}

// A small wall must still show everyone rather than one face on repeat.
assert.equal(
  new Set(chooseFlipIndices(4)).size,
  4,
  'a four-portrait wall should use all four',
);

/** Pages live at once at the busiest instant of a run. */
function peakConcurrency(flips: ReturnType<typeof scheduleFlips>) {
  let peak = 0;
  for (let t = 0; t <= totalMs(); t += 4) {
    const live = flips.filter((flip) => {
      const p = (t - flip.startMs) / flip.lifeMs;
      return p >= 0 && p <= 1;
    }).length;
    peak = Math.max(peak, live);
  }
  return peak;
}

// The pool must clear the real peak, not an assumed one: the minimum page life
// holds the fastest pages open far longer than their own cadence.
const peak = peakConcurrency(scheduleFlips(chooseFlipIndices(200)));
assert.ok(
  POOL_SIZE > peak,
  `pool of ${POOL_SIZE} does not clear the measured peak of ${peak} pages`,
);

// Once a wall has more portraits than are ever in the air at once, a reused
// portrait must never appear twice simultaneously. Below that, repeats are
// unavoidable and obvious to anyone in the room.
for (const total of [peak + 1, peak + 6, 25, 60]) {
  const reused = scheduleFlips(chooseFlipIndices(total));
  for (let t = 0; t <= totalMs(); t += 6) {
    const shown = reused
      .filter((flip) => {
        const p = (t - flip.startMs) / flip.lifeMs;
        return p >= 0 && p <= 1;
      })
      .map((flip) => flip.entryIndex);
    assert.equal(
      new Set(shown).size,
      shown.length,
      `the same portrait was on screen twice at t=${t}ms with ${total} portraits`,
    );
  }
}

const big = chooseFlipIndices(200);
assert.equal(big.length, FLIP_COUNT);
big.forEach((index) => {
  assert.ok(index >= 0 && index < 200, `index ${index} out of range`);
});
// The newest captures are held back so they land right before the lock-up.
assert.deepEqual(big.slice(-RECENT_TAIL), [195, 196, 197, 198, 199]);
// The rest spread across the whole event rather than clustering.
assert.ok(big[0] < 10, `first spread index should be early, got ${big[0]}`);
assert.ok(
  big[FLIP_COUNT - RECENT_TAIL - 1] > 150,
  'the spread should reach the recent end of the event',
);

// --- the schedule ---------------------------------------------------------

const flips = scheduleFlips(chooseFlipIndices(200));
assert.equal(flips.length, FLIP_COUNT);
assert.equal(flips[0].startMs, OPEN_MS, 'the run starts once the spine is out');

const cadences = flips
  .slice(1)
  .map((flip, index) => flip.startMs - flips[index].startMs);
// The whole point of the movement: every gap is shorter than the one before.
cadences.forEach((cadence, index) => {
  if (index === 0) return;
  assert.ok(
    cadence < cadences[index - 1],
    `cadence ${index} (${cadence.toFixed(1)}ms) should be shorter than the previous`,
  );
});
assert.ok(
  cadences[cadences.length - 1] < cadences[0] / 3,
  'the run should end at least three times faster than it starts',
);

// The run fills its window: the last page leaves the gate inside the final
// few percent of it, so the acceleration runs right up to the lock-up rather
// than petering out early.
const lastStart = flips[flips.length - 1].startMs;
assert.ok(
  lastStart < OPEN_MS + FLIP_MS,
  `last page should start before ${OPEN_MS + FLIP_MS}ms, started at ${lastStart.toFixed(0)}ms`,
);
assert.ok(
  lastStart > OPEN_MS + FLIP_MS * 0.95,
  `last page should start in the final 5% of the run, started at ${lastStart.toFixed(0)}ms`,
);

for (const count of [1, 3, 7, FLIP_COUNT, 200]) {
  const scheduled = scheduleFlips(chooseFlipIndices(count));
  assert.equal(scheduled.length, Math.min(count, FLIP_COUNT));
  scheduled.forEach((flip) => {
    assert.ok(flip.slot >= 0 && flip.slot < POOL_SIZE, 'slot within the pool');
    assert.ok(flip.lifeMs > 0, 'every card has a life');
  });
}

// --- the frames -----------------------------------------------------------

// No two cards may share a pool slot at any instant, or one would overwrite
// the other mid-turn.
let everSawCards = false;
let maxConcurrent = 0;
for (let t = 0; t <= SLOGAN_FLIP_TOTAL_MS; t += 4) {
  const live = flips.filter((flip) => {
    const p = (t - flip.startMs) / flip.lifeMs;
    return p >= 0 && p <= 1;
  });
  const slots = new Set(live.map((flip) => flip.slot));
  assert.equal(
    slots.size,
    live.length,
    `two cards shared a slot at t=${t}ms (${live.length} live)`,
  );
  maxConcurrent = Math.max(maxConcurrent, live.length);
  if (live.length > 0) everSawCards = true;
}
assert.ok(everSawCards, 'the run must actually show cards');
assert.ok(
  maxConcurrent <= POOL_SIZE,
  `overlap ${maxConcurrent} exceeds the pool of ${POOL_SIZE}`,
);
// Being inside a riffled stack means several pages are always in the air. Two
// was the old single-lane look and reads as a slideshow.
assert.ok(
  maxConcurrent >= LANE_COUNT,
  `at least ${LANE_COUNT} pages should overlap, saw at most ${maxConcurrent}`,
);

// Depth is what stops it looking like a queue: while several pages are in the
// air they must sit at different distances from the camera.
let sawMultipleLanes = false;
for (let t = OPEN_MS; t <= OPEN_MS + FLIP_MS; t += 8) {
  const frame = flipFrameAt(t, flips);
  if (frame.cards.size < 2) continue;
  const lanes = new Set([...frame.cards.values()].map((card) => card.lane));
  if (lanes.size >= 2) sawMultipleLanes = true;
  const depths = new Set(
    [...frame.cards.values()].map((card) => Math.round(card.depthPx / 10)),
  );
  assert.ok(
    depths.size > 1,
    `pages were flat against each other at t=${t}ms`,
  );
}
assert.ok(sawMultipleLanes, 'pages must occupy more than one depth lane');

// The stack is never a perfect deck.
const rolls = new Set(
  flips.map((flip) =>
    flipFrameAt(flip.startMs + flip.lifeMs / 2, flips).cards.get(flip.slot)?.rollDeg,
  ),
);
assert.ok(rolls.size > 4, 'pages should carry varied roll, not one angle');

// A card sweeps edge-on, through flat, to edge-on, and is only opaque between.
const probe = flips[0];
const atStart = flipFrameAt(probe.startMs, flips).cards.get(probe.slot);
const atMid = flipFrameAt(probe.startMs + probe.lifeMs / 2, flips).cards.get(
  probe.slot,
);
const atEnd = flipFrameAt(probe.startMs + probe.lifeMs, flips).cards.get(
  probe.slot,
);
assert.ok(atStart && atMid && atEnd, 'the probe card exists across its life');
assert.ok(atStart.angleDeg < -90, 'starts edge-on, rising');
assert.ok(Math.abs(atMid.angleDeg) < 1, 'passes flat at mid-turn');
assert.ok(atEnd.angleDeg > 90, 'leaves edge-on');
assert.ok(atStart.opacity < 0.05, 'invisible while edge-on at entry');
assert.equal(atMid.opacity, 1, 'fully present when flat');
assert.ok(atEnd.opacity < 0.05, 'invisible while edge-on at exit');
assert.ok(atMid.rim < atStart.rim, 'the rim light peaks when the card is steep');
assert.ok(atMid.depthPx > atStart.depthPx, 'the card comes toward the viewer');
// The flat frame is the only one anyone can actually read, so it stays sharp.
assert.ok(atMid.blurPx < 0.01, 'no smear at the readable flat moment');
assert.ok(atStart.blurPx > 0, 'steep pages smear');

// Late pages turn faster, so they smear harder than early ones at the same
// point in their turn — the blur tracks real speed rather than being decorative.
const early = flips[1];
const late = flips[flips.length - 2];
const earlySmear = flipFrameAt(early.startMs + early.lifeMs * 0.08, flips).cards.get(
  early.slot,
)?.blurPx;
const lateSmear = flipFrameAt(late.startMs + late.lifeMs * 0.08, flips).cards.get(
  late.slot,
)?.blurPx;
assert.ok(earlySmear !== undefined && lateSmear !== undefined);
assert.ok(
  lateSmear > earlySmear,
  `the accelerating run should smear more, got ${earlySmear.toFixed(1)} then ${lateSmear.toFixed(1)}`,
);

// --- the arc of the whole movement ---------------------------------------

const opening = flipFrameAt(0, flips);
const midRun = flipFrameAt(OPEN_MS + FLIP_MS / 2, flips);
const runEnd = flipFrameAt(OPEN_MS + FLIP_MS, flips);
const locked = flipFrameAt(SLOGAN_FLIP_TOTAL_MS, flips);

// The spine arrives first and never leaves.
assert.ok(opening.spineScale < 0.2, 'the spine starts collapsed');
assert.ok(flipFrameAt(OPEN_MS, flips).spineScale > 0.99, 'the spine opens fully');
assert.equal(locked.spineOpacity, 1, 'the spine survives into the final frame');

// Speed becomes light.
assert.ok(midRun.heat > opening.heat, 'the field heats as the run accelerates');
assert.ok(runEnd.lift > midRun.lift, 'and keeps lifting to the end of the run');

// The dolly never stops — not during the run, and not once the sentence is up.
// A camera that parks is what makes a finale read as a slide.
const cameraTrack = [0, OPEN_MS, OPEN_MS + FLIP_MS / 2, OPEN_MS + FLIP_MS, SLOGAN_FLIP_TOTAL_MS]
  .map((t) => flipFrameAt(t, flips).cameraScale);
cameraTrack.forEach((scale, index) => {
  if (index === 0) return;
  assert.ok(
    scale > cameraTrack[index - 1],
    `camera stalled between sample ${index - 1} and ${index}`,
  );
});
assert.ok(
  locked.cameraScale > 1.35,
  `the push should be felt, ended at ${locked.cameraScale.toFixed(2)}`,
);

// The frame opens up while pages run and closes again under the sentence.
assert.ok(
  runEnd.vignette < opening.vignette,
  'the vignette should pull back as the run fills the frame',
);
assert.ok(
  locked.vignette > runEnd.vignette,
  'and close again to seat the sentence',
);

// The sentence only exists after the pages stop.
assert.equal(opening.typeOpacity, 0, 'no sentence during the open');
assert.equal(midRun.typeOpacity, 0, 'no sentence mid-run');
assert.equal(locked.typeOpacity, 1, 'the sentence is fully resolved at the end');
assert.ok(
  locked.typeScale < flipFrameAt(OPEN_MS + FLIP_MS + LOCK_MS * 0.2, flips).typeScale,
  'the sentence settles down to size rather than growing into place',
);

// The flash is a single spike inside the lock-up, not a general glow.
assert.equal(runEnd.flash, 0, 'no flash before the last page lands');
assert.equal(midRun.flash, 0, 'no flash during the run');
const flashPeak = Math.max(
  ...Array.from({ length: 60 }, (_, index) =>
    flipFrameAt(OPEN_MS + FLIP_MS + (index / 59) * LOCK_MS, flips).flash,
  ),
);
assert.ok(flashPeak > 0.8, `the lock-up should blow out, peaked at ${flashPeak.toFixed(2)}`);

// No cards remain once the sentence is up.
assert.equal(locked.cards.size, 0, 'the pages are gone by the final frame');

// An empty wall degrades to a bare open-and-resolve rather than throwing.
const emptyFlips = scheduleFlips(chooseFlipIndices(0));
assert.deepEqual(emptyFlips, []);
assert.equal(flipFrameAt(SLOGAN_FLIP_TOTAL_MS, emptyFlips).typeOpacity, 1);

console.log('Slogan flip finale tests passed.');
