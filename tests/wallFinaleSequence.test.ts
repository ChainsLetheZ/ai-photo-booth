import assert from 'node:assert/strict';
import {
  chooseFinalePhotos,
  DEFAULT_FINALE_TIMING,
  FINALE_CARD_COUNT,
  FINALE_PHASE_ORDER,
  finaleCardWidthPx,
  finaleDurationMs,
  finaleFrameAt,
  finaleGridFor,
  finaleTotalMs,
  layoutFinaleCards,
  nextFinalePhase,
  phaseStartMs,
} from '../services/wallFinaleSequence';
import { FINAL_TAGLINE } from '../constants';

// --- phase order and timing ------------------------------------------------

assert.deepEqual(FINALE_PHASE_ORDER, [
  'freeze',
  'converge',
  'pulse',
  'retreat',
  'tagline',
]);
assert.equal(nextFinalePhase('freeze'), 'converge');
assert.equal(nextFinalePhase('converge'), 'pulse');
assert.equal(nextFinalePhase('pulse'), 'retreat');
assert.equal(nextFinalePhase('retreat'), 'tagline');
assert.equal(nextFinalePhase('tagline'), null, 'the sentence holds; nothing follows it');
assert.equal(FINAL_TAGLINE.length, 8, 'the final screen is configured with exactly eight characters');

const total = finaleTotalMs();
const summed = FINALE_PHASE_ORDER.reduce(
  (sum, phase) => sum + finaleDurationMs(phase),
  0,
);
assert.equal(total, summed);
assert.equal(phaseStartMs('freeze'), 0);
FINALE_PHASE_ORDER.slice(1).forEach((phase, index) => {
  const previous = FINALE_PHASE_ORDER[index];
  assert.equal(
    phaseStartMs(phase),
    phaseStartMs(previous) + finaleDurationMs(previous),
    `${phase} should start exactly when ${previous} ends`,
  );
});

// --- which portraits converge ----------------------------------------------

assert.deepEqual(chooseFinalePhotos(0), []);
assert.deepEqual(chooseFinalePhotos(5), [0, 1, 2, 3, 4]);
assert.equal(chooseFinalePhotos(FINALE_CARD_COUNT).length, FINALE_CARD_COUNT);

for (const roomSize of [FINALE_CARD_COUNT + 1, 60, 200]) {
  const chosen = chooseFinalePhotos(roomSize);
  assert.equal(chosen.length, FINALE_CARD_COUNT);
  // No portrait appears twice in a still grid — unlike the flip this replaced,
  // every card is visible at once for the whole sequence, so a repeat would be
  // the same face on screen twice simultaneously, not a brief coincidence.
  assert.equal(
    new Set(chosen).size,
    chosen.length,
    `chooseFinalePhotos(${roomSize}) produced a duplicate`,
  );
  chosen.forEach((index) => {
    assert.ok(index >= 0 && index < roomSize, `index ${index} outside 0..${roomSize}`);
  });
  // Spread across the whole event, not clustered at the start.
  assert.ok(chosen[0] < roomSize * 0.1, 'first card should be early in the event');
  assert.ok(
    chosen[chosen.length - 1] > roomSize * 0.85,
    'last card should be late in the event',
  );
}

// --- the grid ---------------------------------------------------------------

assert.deepEqual(finaleGridFor(0), { cols: 0, rows: 0 });
for (const count of [1, 5, 12, 28, 40]) {
  const { cols, rows } = finaleGridFor(count);
  assert.ok(cols > 0 && rows > 0, `grid for ${count} must have both dimensions`);
  assert.ok(
    cols * rows >= count,
    `grid ${cols}x${rows} cannot hold ${count} cards`,
  );
  assert.ok(
    cols * rows <= count + Math.max(cols, rows),
    `grid ${cols}x${rows} for ${count} cards has too much slack`,
  );
}

// --- layout: everything lands inside the stage ------------------------------

assert.deepEqual(layoutFinaleCards([]), []);
const layout = layoutFinaleCards(chooseFinalePhotos(200));
assert.equal(layout.length, FINALE_CARD_COUNT);
layout.forEach((card) => {
  assert.ok(card.targetX > 0 && card.targetX < 1, 'target x inside the stage');
  assert.ok(card.targetY > 0 && card.targetY < 1, 'target y inside the stage');
  assert.ok(card.startX >= 0 && card.startX <= 1, 'scatter x inside the stage');
  assert.ok(card.startY >= 0 && card.startY <= 1, 'scatter y inside the stage');
  assert.ok(
    Math.abs(card.targetRotationDeg) <= 3,
    'rotation should be a light tilt, not a spin',
  );
});
// The grid must not be a single row or column — it should read as a wall.
const xs = new Set(layout.map((card) => Math.round(card.targetX * 100)));
const ys = new Set(layout.map((card) => Math.round(card.targetY * 100)));
assert.ok(xs.size > 3, 'the grid should have more than one column');
assert.ok(ys.size > 1, 'the grid should have more than one row');
// No two cards share a target cell.
const targets = layout.map((card) => `${card.targetX.toFixed(3)},${card.targetY.toFixed(3)}`);
assert.equal(new Set(targets).size, targets.length, 'two cards landed on the same cell');

// A 4:3 card must fit inside both axes of every target cell at the venue's
// 1920×1080 canvas. This prevents the overlapping portrait columns the old
// fixed-vmin size produced.
for (const count of [12, 28]) {
  const { cols, rows } = finaleGridFor(count);
  const width = finaleCardWidthPx(1920, 1080, count);
  const height = width * 0.75;
  assert.ok(width < (1920 * 0.6) / cols, `${count} cards need a horizontal gap`);
  assert.ok(height < (1080 * 0.54) / rows, `${count} cards need a vertical gap`);
}

// A captured wall tile can begin at its real position and scale without
// changing any crop property in the frame model.
const capturedLayout = [{ ...layout[0], startX: 0.2, startY: 0.3, startScale: 2.4 }];
const capturedStart = finaleFrameAt(phaseStartMs('converge'), capturedLayout).cards[0];
assert.equal(capturedStart.xUnit, 0.2);
assert.equal(capturedStart.yUnit, 0.3);
assert.equal(capturedStart.scale, 2.4);

// --- the frames across the sequence -----------------------------------------

const convergeStart = phaseStartMs('converge');
const pulseStart = phaseStartMs('pulse');
const retreatStart = phaseStartMs('retreat');
const taglineStart = phaseStartMs('tagline');

// Freeze belongs to the wall's own tiles; this module draws nothing yet.
const duringFreeze = finaleFrameAt(convergeStart * 0.5, layout);
assert.ok(
  duringFreeze.cards.every((card) => card.opacity === 0),
  'no card should be visible before the converge starts',
);
assert.equal(duringFreeze.pulseXUnit, null);

// Converge: portraits arrive at the scatter point and move to their cell,
// fading and growing in as they go — never re-cropped, only transformed.
const midConverge = finaleFrameAt(convergeStart + DEFAULT_FINALE_TIMING.convergeMs / 2, layout);
const probe = layout[0];
const probeMid = midConverge.cards.find((card) => card.entryIndex === probe.entryIndex)!;
assert.ok(probeMid.opacity > 0 && probeMid.opacity < 1, 'fading in mid-converge');
assert.ok(probeMid.scale > 0.5 && probeMid.scale < 1, 'growing in mid-converge');
const betweenStartAndTarget =
  (probeMid.xUnit - probe.startX) * (probe.targetX - probe.startX) >= 0;
assert.ok(betweenStartAndTarget, 'the card should be moving toward its cell, not away from it');

// At the end of converge, every card must be settled exactly at its cell.
const convergeEnd = finaleFrameAt(pulseStart - 1, layout);
convergeEnd.cards.forEach((card) => {
  const target = layout.find((entry) => entry.entryIndex === card.entryIndex)!;
  assert.ok(Math.abs(card.xUnit - target.targetX) < 0.01, 'settled on x');
  assert.ok(Math.abs(card.yUnit - target.targetY) < 0.01, 'settled on y');
  assert.ok(card.opacity > 0.97, 'fully resolved before the pulse');
});

// Pulse: a sweep crosses the grid once, left to right, and each card's glow
// rises and falls as the sweep passes it — this is the "AI perception" beat,
// so it has to visibly travel rather than flashing everywhere at once.
const leftCard = layout.reduce((a, b) => (a.targetX < b.targetX ? a : b));
const rightCard = layout.reduce((a, b) => (a.targetX > b.targetX ? a : b));
const glowOf = (t: number, entryIndex: number) =>
  finaleFrameAt(t, layout).cards.find((card) => card.entryIndex === entryIndex)!
    .glow;

const leftGlowEarly = glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.15, leftCard.entryIndex);
const leftGlowLate = glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.85, leftCard.entryIndex);
const rightGlowEarly = glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.15, rightCard.entryIndex);
const rightGlowLate = glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.85, rightCard.entryIndex);
assert.ok(leftGlowEarly > rightGlowEarly, 'the leftmost card should light up before the rightmost');
assert.ok(rightGlowLate > leftGlowLate, 'the rightmost card should light up after the leftmost');
assert.ok(
  [leftGlowEarly, leftGlowLate, rightGlowEarly, rightGlowLate].every((v) => v >= 0 && v <= 1),
  'glow stays within 0..1',
);
// At rest, off the sweep, glow is negligible — the effect must be a pass, not
// a constant wash.
assert.ok(glowOf(pulseStart + 2, rightCard.entryIndex) < 0.05, 'not lit before the sweep arrives');

// A card is never both re-cropped and glowing — there is no crop concept in
// this module at all: confirm the frame never exposes anything but transform-
// safe properties.
Object.keys(finaleFrameAt(pulseStart, layout).cards[0]).forEach((key) => {
  assert.ok(
    ['entryIndex', 'xUnit', 'yUnit', 'scale', 'rotationDeg', 'opacity', 'blurPx', 'glow'].includes(key),
    `unexpected card property ${key}`,
  );
});

// Retreat: the grid gives up the frame together.
const midRetreat = finaleFrameAt(retreatStart + DEFAULT_FINALE_TIMING.retreatMs / 2, layout);
midRetreat.cards.forEach((card) => {
  assert.ok(card.opacity < 1 && card.opacity > 0, 'fading out mid-retreat');
  assert.ok(card.blurPx > 0, 'smearing out mid-retreat');
  assert.ok(card.scale < 1, 'shrinking mid-retreat');
});
const retreatEnd = finaleFrameAt(taglineStart - 1, layout);
retreatEnd.cards.forEach((card) => {
  assert.ok(card.opacity < 0.03, 'fully gone by the end of the retreat');
});

// Tagline: resolves from a blur and holds. No card is visible behind it.
const beforeTagline = finaleFrameAt(taglineStart, layout);
assert.equal(beforeTagline.taglineOpacity, 0);
assert.ok(beforeTagline.taglineBlurPx > 10, 'starts as a soft blur, not sharp text');

const locked = finaleFrameAt(finaleTotalMs(), layout);
assert.equal(locked.taglineOpacity, 1, 'fully resolved by the end of the sequence');
assert.ok(locked.taglineBlurPx < 0.1, 'sharp by the end');
assert.ok(
  locked.taglineScale < finaleFrameAt(taglineStart + DEFAULT_FINALE_TIMING.taglineMs * 0.3, layout).taglineScale,
  'the sentence settles down to size rather than growing into place',
);
assert.ok(
  locked.cards.every((card) => card.opacity < 0.03),
  'the pages are gone by the time the sentence is up',
);
assert.ok(locked.haloOpacity > 0, 'a restrained halo, not a blank hold');
assert.ok(locked.haloOpacity < 0.5, 'the halo must stay behind the text, not compete with it');

// Holding past the total time must not throw or move anything further.
const wayPast = finaleFrameAt(finaleTotalMs() + 5000, layout);
assert.deepEqual(wayPast.taglineOpacity, locked.taglineOpacity);
assert.deepEqual(wayPast.taglineBlurPx, locked.taglineBlurPx);

// An empty wall still resolves the sentence rather than throwing.
const emptyLayout = layoutFinaleCards(chooseFinalePhotos(0));
assert.equal(finaleFrameAt(finaleTotalMs(), emptyLayout).taglineOpacity, 1);

console.log('Wall finale sequence tests passed.');
