import assert from 'node:assert/strict';
import {
  chooseFinalePhotos,
  DEFAULT_FINALE_TIMING,
  FINALE_CARD_COUNT,
  FINALE_PHASE_ORDER,
  FINALE_VIDEO_FRAME_GEOMETRY,
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
assert.equal(FINALE_CARD_COUNT, 2304);
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
  assert.ok(card.depthTier >= 0 && card.depthTier <= 2);
  assert.ok(card.arrivalDelayUnit >= 0 && card.arrivalDelayUnit < 0.79);
  assert.ok(card.arrivalDelayUnit + card.arrivalDurationUnit < 1);
});
assert.deepEqual(
  [...new Set(layout.map((card) => card.depthTier))].sort(),
  [0, 1, 2],
  'the letterform contains back, middle, and foreground waves',
);

// Even a small group settles as compact points, rather than another large grid
// of photo cards.
assert.equal(finaleCardWidthPx(0, 1080, 80), 0);
assert.ok(finaleCardWidthPx(1920, 1080, 8) > 5);
assert.ok(finaleCardWidthPx(1920, 1080, 2304) > 5);
assert.ok(finaleCardWidthPx(1920, 1080, 2304) < 6);

const capturedLayout = [{ ...layout[0], startX: 0.2, startY: 0.3, startScale: 12 }];
const capturedStart = finaleFrameAt(
  phaseStartMs('converge'),
  capturedLayout,
).cards[0];
assert.equal(capturedStart.xUnit, capturedLayout[0].startX);
assert.equal(capturedStart.yUnit, capturedLayout[0].startY);
assert.equal(capturedStart.scale, capturedLayout[0].startScale);

const convergeStart = phaseStartMs('converge');
const pulseStart = phaseStartMs('pulse');
const retreatStart = phaseStartMs('retreat');
const taglineStart = phaseStartMs('tagline');

const duringFreeze = finaleFrameAt(convergeStart * 0.5, layout);
assert.ok(duringFreeze.cards.every((card) => card.opacity === 0));

const midConverge = finaleFrameAt(
  // This is inside the first depth wave: it has started but has not settled,
  // while the foreground wave has not launched yet.
  convergeStart + DEFAULT_FINALE_TIMING.convergeMs * 0.18,
  layout,
);
// At the halfway mark only the back wave is guaranteed to be in flight; the
// foreground wave deliberately has not launched yet.
const probe = layout.find((card) => card.depthTier === 0)!;
const probeMid = midConverge.cards.find((card) => card.entryIndex === probe.entryIndex)!;
assert.ok(probeMid.opacity > 0 && probeMid.opacity <= 1);
assert.ok(probeMid.xUnit > Math.min(probe.startX, probe.targetX));
assert.ok(probeMid.xUnit < Math.max(probe.startX, probe.targetX));
assert.ok(probeMid.yUnit > Math.min(probe.startY, probe.targetY));
assert.ok(probeMid.yUnit < Math.max(probe.startY, probe.targetY));
assert.equal(midConverge.cameraScale, 1);
assert.ok(probeMid.pixelMix >= 0 && probeMid.pixelMix < 1);

// At one instant the back layer has travelled farther and shrunk more than
// the foreground layer. This is the visible depth separation the old global
// ease curve could not produce.
const farIndex = layout.findIndex((card) => card.depthTier === 0);
const nearIndex = layout.findIndex((card) => card.depthTier === 2);
const farLayout = layout[farIndex];
const nearLayout = layout[nearIndex];
const farFrame = midConverge.cards[farIndex];
const nearFrame = midConverge.cards[nearIndex];
const farTravel = Math.hypot(
  farFrame.xUnit - farLayout.startX,
  farFrame.yUnit - farLayout.startY,
) / Math.max(0.0001, Math.hypot(
  farLayout.targetX - farLayout.startX,
  farLayout.targetY - farLayout.startY,
));
const nearTravel = Math.hypot(
  nearFrame.xUnit - nearLayout.startX,
  nearFrame.yUnit - nearLayout.startY,
) / Math.max(0.0001, Math.hypot(
  nearLayout.targetX - nearLayout.startX,
  nearLayout.targetY - nearLayout.startY,
));
assert.ok(farTravel > nearTravel + 0.25);
const farShrink = (farLayout.startScale - farFrame.scale) / (farLayout.startScale - 1);
const nearShrink = (nearLayout.startScale - nearFrame.scale) / (nearLayout.startScale - 1);
assert.ok(farShrink > nearShrink + 0.25);

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

const midScan = finaleFrameAt(
  pulseStart + DEFAULT_FINALE_TIMING.pulseMs / 2,
  layout,
);
assert.equal(midScan.kvRevealXUnit, 1);
assert.equal(midScan.taglineOpacity, 0);
assert.equal(midScan.pulseXUnit, null);
assert.ok(midScan.cards.every((card) => card.glow === 0));

// At the hand-off the measured video headline has the same centre and apparent
// width as the central photo headline, with no uncovered screen edge.
const retreatFocus = finaleFrameAt(retreatStart, layout);
const geometry = FINALE_VIDEO_FRAME_GEOMETRY;
const focusedHeadlineX =
  retreatFocus.kvTranslateXUnit + geometry.headlineCenterXUnit * retreatFocus.kvScale;
const focusedHeadlineY =
  retreatFocus.kvTranslateYUnit + geometry.headlineCenterYUnit * retreatFocus.kvScale;
assert.ok(Math.abs(focusedHeadlineX - geometry.photoHeadlineCenterXUnit) < 0.0001);
assert.ok(Math.abs(focusedHeadlineY - geometry.photoHeadlineCenterYUnit) < 0.0001);
assert.ok(
  Math.abs(
    geometry.headlineWidthUnit * retreatFocus.kvScale -
      geometry.photoHeadlineWidthUnit,
  ) < 0.001,
);
assert.ok(retreatFocus.kvTranslateXUnit <= 0);
assert.ok(retreatFocus.kvTranslateYUnit <= 0);
assert.ok(retreatFocus.kvTranslateXUnit + retreatFocus.kvScale >= 1);
assert.ok(retreatFocus.kvTranslateYUnit + retreatFocus.kvScale >= 1);

// The photo/KV cross-fade completes before the pullback begins, so the title
// never tries to move while it is still made of guest portraits.
const handoffEnd = finaleFrameAt(
  retreatStart + DEFAULT_FINALE_TIMING.retreatMs * 0.42,
  layout,
);
assert.ok(handoffEnd.cards.every((card) => card.opacity < 0.001));
assert.equal(handoffEnd.kvOpacity, 1);
assert.ok(Math.abs(handoffEnd.kvScale - geometry.focusScale) < 0.0001);

const midRetreat = finaleFrameAt(
  retreatStart + DEFAULT_FINALE_TIMING.retreatMs * 0.7,
  layout,
);
midRetreat.cards.forEach((card) => {
  assert.ok(card.opacity < 0.05);
  assert.equal(card.blurPx, 0);
  assert.equal(card.scale, 1);
});
assert.equal(midRetreat.kvOpacity, 1);
assert.ok(midRetreat.kvScale > 1 && midRetreat.kvScale < geometry.focusScale);
assert.ok(midRetreat.kvTranslateXUnit < 0);
assert.ok(midRetreat.kvTranslateYUnit < 0);

const noFlashFrame = finaleFrameAt(taglineStart - 40, layout);
assert.equal(noFlashFrame.flashOpacity, 0);

const locked = finaleFrameAt(finaleTotalMs(), layout);
locked.cards.forEach((card) => {
  const target = layout[card.entryIndex];
  assert.equal(card.opacity, 0);
  assert.ok(Math.abs(card.xUnit - target.targetX) < 0.0001);
  assert.ok(Math.abs(card.yUnit - target.targetY) < 0.0001);
  assert.equal(card.scale, 1);
});
assert.equal(locked.taglineOpacity, 1);
assert.equal(locked.kvOpacity, 1);
assert.equal(locked.kvScale, 1);
assert.ok(Math.abs(locked.kvTranslateXUnit) < 0.000001);
assert.ok(Math.abs(locked.kvTranslateYUnit) < 0.000001);
assert.equal(locked.kvRevealXUnit, 1);
assert.equal(locked.flashOpacity, 0);
assert.equal(locked.haloOpacity, 0);

const empty = finaleFrameAt(taglineStart, layoutFinaleCards([]));
assert.equal(empty.taglineOpacity, 1);
assert.equal(finaleFrameAt(total, layoutFinaleCards([])).taglineOpacity, 1);

console.log('Wall finale photo-letterform tests passed.');
