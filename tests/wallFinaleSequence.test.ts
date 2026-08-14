import assert from 'node:assert/strict';
import {
  chooseFinalePhotos,
  DEFAULT_FINALE_TIMING,
  FINALE_CARD_COUNT,
  FINALE_PHASE_ORDER,
  finaleCardWidthPx,
  finaleDurationMs,
  finaleFrameAt,
  finaleTotalMs,
  layoutFinaleCards,
  nextFinalePhase,
  phaseStartMs,
  type FinalePixelTarget,
} from '../services/wallFinaleSequence';

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
assert.equal(nextFinalePhase('tagline'), null);

const total = finaleTotalMs();
assert.equal(
  total,
  FINALE_PHASE_ORDER.reduce(
    (sum, phase) => sum + finaleDurationMs(phase),
    0,
  ),
);
FINALE_PHASE_ORDER.slice(1).forEach((phase, index) => {
  const previous = FINALE_PHASE_ORDER[index];
  assert.equal(
    phaseStartMs(phase),
    phaseStartMs(previous) + finaleDurationMs(previous),
  );
});

// The finale's capacity is the wall capacity: no sampled subset silently drops
// people from the final collective image.
assert.equal(FINALE_CARD_COUNT, 1296);
assert.deepEqual(chooseFinalePhotos(0), []);
assert.deepEqual(chooseFinalePhotos(5), [0, 1, 2, 3, 4]);
assert.equal(chooseFinalePhotos(200).length, 200);

const indices = Array.from({ length: 80 }, (_, index) => index);
const targets: FinalePixelTarget[] = indices.map((index) => ({
  xUnit: 0.18 + (index % 20) * 0.032,
  yUnit: 0.4 + Math.floor(index / 20) * 0.04,
}));
const layout = layoutFinaleCards(indices, targets);
assert.equal(layout.length, indices.length);
layout.forEach((card, index) => {
  assert.equal(card.targetX, targets[index].xUnit, 'uses the KV-pixel x');
  assert.equal(card.targetY, targets[index].yUnit, 'uses the KV-pixel y');
  assert.equal(card.targetRotationDeg, 0, 'pixels settle without card tilts');
  assert.ok(card.startX >= 0 && card.startX <= 1);
  assert.ok(card.startY >= 0 && card.startY <= 1);
});

// Even a small group settles as compact points, rather than another large grid
// of photo cards.
assert.equal(finaleCardWidthPx(0, 1080, 80), 0);
assert.ok(finaleCardWidthPx(1920, 1080, 8) > 300);
assert.ok(finaleCardWidthPx(1920, 1080, 1296) > 35);
assert.ok(finaleCardWidthPx(1920, 1080, 1296) < 45);

const capturedLayout = [{ ...layout[0], startX: 0.2, startY: 0.3, startScale: 12 }];
const capturedStart = finaleFrameAt(
  phaseStartMs('converge'),
  capturedLayout,
).cards[0];
assert.equal(capturedStart.xUnit, capturedLayout[0].targetX);
assert.equal(capturedStart.yUnit, capturedLayout[0].targetY);
assert.equal(capturedStart.scale, 1);

const convergeStart = phaseStartMs('converge');
const pulseStart = phaseStartMs('pulse');
const retreatStart = phaseStartMs('retreat');
const taglineStart = phaseStartMs('tagline');

const duringFreeze = finaleFrameAt(convergeStart * 0.5, layout);
assert.ok(duringFreeze.cards.every((card) => card.opacity === 0));

const midConverge = finaleFrameAt(
  convergeStart + DEFAULT_FINALE_TIMING.convergeMs / 2,
  layout,
);
const probe = layout[0];
const probeMid = midConverge.cards.find((card) => card.entryIndex === probe.entryIndex)!;
assert.ok(probeMid.opacity > 0 && probeMid.opacity < 1);
assert.equal(probeMid.xUnit, probe.targetX);
assert.equal(probeMid.yUnit, probe.targetY);
assert.ok(midConverge.cameraScale > 1);
assert.ok(midConverge.cameraScale < 8);
assert.ok(probeMid.pixelMix >= 0 && probeMid.pixelMix < 1);

const convergeEnd = finaleFrameAt(pulseStart - 1, layout);
assert.ok(Math.abs(convergeEnd.cameraScale - 1) < 0.001);
assert.ok(Math.abs(convergeEnd.cameraXUnit) < 0.001);
assert.ok(Math.abs(convergeEnd.cameraYUnit) < 0.001);
assert.equal(convergeEnd.kvRevealXUnit, 1);
convergeEnd.cards.forEach((card) => {
  const target = layout[card.entryIndex];
  assert.ok(Math.abs(card.xUnit - target.targetX) < 0.01);
  assert.ok(Math.abs(card.yUnit - target.targetY) < 0.01);
  assert.ok(card.opacity > 0.97);
});

const left = layout.reduce((a, b) => (a.targetX < b.targetX ? a : b));
const right = layout.reduce((a, b) => (a.targetX > b.targetX ? a : b));
const glowOf = (timeMs: number, entryIndex: number) =>
  finaleFrameAt(timeMs, layout).cards.find((card) => card.entryIndex === entryIndex)!.glow;
assert.ok(
  glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.15, left.entryIndex) >
    glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.15, right.entryIndex),
);
const midScan = finaleFrameAt(
  pulseStart + DEFAULT_FINALE_TIMING.pulseMs / 2,
  layout,
);
assert.equal(midScan.kvRevealXUnit, 1);
assert.ok(midScan.taglineOpacity > 0 && midScan.taglineOpacity < 1);
assert.ok(
  glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.85, right.entryIndex) >
    glowOf(pulseStart + DEFAULT_FINALE_TIMING.pulseMs * 0.85, left.entryIndex),
);

// The sampled KV pixels contract and fade behind a flash before the clean,
// high-resolution master KV takes over.
const midRetreat = finaleFrameAt(
  retreatStart + DEFAULT_FINALE_TIMING.retreatMs / 2,
  layout,
);
midRetreat.cards.forEach((card) => {
  assert.ok(card.opacity > 0 && card.opacity < 1);
  assert.ok(card.blurPx > 0);
  assert.ok(card.scale < 1);
});

const noFlashFrame = finaleFrameAt(taglineStart - 40, layout);
assert.equal(noFlashFrame.flashOpacity, 0);

const locked = finaleFrameAt(finaleTotalMs(), layout);
locked.cards.forEach((card) => {
  const target = layout[card.entryIndex];
  assert.ok(card.opacity < 0.01);
  assert.ok(Math.abs(card.xUnit - target.targetX) < 0.0001);
  assert.ok(Math.abs(card.yUnit - target.targetY) < 0.0001);
  assert.ok(card.scale < 0.9);
});
assert.equal(locked.taglineOpacity, 1);
assert.equal(locked.kvRevealXUnit, 1);
assert.equal(locked.flashOpacity, 0);
assert.ok(locked.haloOpacity > 0 && locked.haloOpacity < 0.5);

const empty = finaleFrameAt(taglineStart, layoutFinaleCards([]));
assert.equal(empty.taglineOpacity, 1);
assert.equal(finaleFrameAt(total, layoutFinaleCards([])).taglineOpacity, 1);

console.log('Wall finale KV pixel tests passed.');
