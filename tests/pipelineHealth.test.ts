import assert from 'node:assert/strict';
import {
  GAP_MIN_MS,
  PipelineHealthRecorder,
  STALE_GAP_MIN_MS,
  type PipelineFrameReport,
} from '../perception/PipelineHealthStore';

const STEP_MS = 50;

function frameReport(
  overrides: Partial<PipelineFrameReport> = {},
): PipelineFrameReport {
  return {
    rawPoseCount: 1,
    sanityAcceptedCount: 1,
    rejectReasons: {},
    confirmedCount: 1,
    reassociatedCount: 0,
    renderPeopleCount: 1,
    renderablePeopleCount: 1,
    renderRequiresConfirmedTracks: true,
    ...overrides,
  };
}

function tick(
  recorder: PipelineHealthRecorder,
  timestamp: number,
  overrides: Partial<PipelineFrameReport> = {},
  drawn = 1,
) {
  recorder.reportCapture(
    { readyState: 4, due: true, started: true },
    timestamp,
  );
  recorder.reportFrame(frameReport(overrides), timestamp);
  recorder.reportRender(
    { source: 'landmarks', available: overrides.renderPeopleCount ?? 1, drawn },
    timestamp,
  );
  recorder.reportRender(
    { source: 'halo', available: overrides.renderPeopleCount ?? 1, drawn },
    timestamp,
  );
}

function layer(
  recorder: PipelineHealthRecorder,
  timestamp: number,
  id: number,
) {
  const found = recorder
    .snapshot(timestamp)
    .layers.find((entry) => entry.id === id);
  assert.ok(found, `layer ${id} is reported`);
  return found!;
}

// A clean run leaves every layer passing and records no gap.
{
  const recorder = new PipelineHealthRecorder();
  let clock = 1_000;
  for (let index = 0; index < 20; index += 1) {
    tick(recorder, clock);
    clock += STEP_MS;
  }
  const at = clock - STEP_MS;
  const snapshot = recorder.snapshot(at);
  snapshot.layers.forEach((entry) => {
    assert.equal(entry.failCount, 0, `layer ${entry.id} has no failures`);
  });
  assert.equal(layer(recorder, at, 2).value, '20');
  assert.equal(layer(recorder, at, 7).value, '20');
  assert.equal(snapshot.lastGap, null);
  assert.deepEqual(snapshot.gapHistory, []);
  assert.equal(snapshot.session.blankGaps, 0);
  assert.equal(snapshot.session.blankMs, 0);
  assert.equal(snapshot.session.observedMs, at - 1_000);
}

// A sanity-filter blackout is attributed to L4 with its dominant reason.
{
  const recorder = new PipelineHealthRecorder();
  let clock = 1_000;
  for (let index = 0; index < 5; index += 1) {
    tick(recorder, clock);
    clock += STEP_MS;
  }
  for (let index = 0; index < 8; index += 1) {
    tick(
      recorder,
      clock,
      {
        sanityAcceptedCount: 0,
        rejectReasons: { missing_core: 2, out_of_roi: 1 },
        confirmedCount: 0,
        renderPeopleCount: 0,
        renderablePeopleCount: 0,
      },
      0,
    );
    clock += STEP_MS;
  }
  const lastVisible = 1_000 + 4 * STEP_MS;
  const recovered = clock;
  tick(recorder, recovered);

  const snapshot = recorder.snapshot(recovered);
  assert.equal(snapshot.gapHistory.length, 1);
  const [gap] = snapshot.gapHistory;
  assert.equal(gap.layer, 4);
  assert.equal(gap.kind, 'blank');
  assert.match(gap.detail, /missing_core/);
  assert.equal(gap.durationMs, recovered - lastVisible);
  assert.equal(gap.open, false);
  assert.equal(layer(recorder, recovered, 4).failCount, 8);
  assert.match(layer(recorder, recovered, 4).detail, /missing_core: 16/);
  // The funnel stops at the failing layer: L5 and L6 are not charged for it.
  assert.equal(layer(recorder, recovered, 5).failCount, 0);
  assert.equal(layer(recorder, recovered, 6).failCount, 0);
  // Session totals are what one configuration gets compared against another on.
  assert.equal(snapshot.session.blankGaps, 1);
  assert.equal(snapshot.session.blankMs, recovered - lastVisible);
  assert.deepEqual(snapshot.session.byLayer, { L4: 1 });
}

// A single dropped frame is inference cadence, not a visible gap.
{
  const recorder = new PipelineHealthRecorder();
  let clock = 1_000;
  tick(recorder, clock);
  clock += STEP_MS;
  tick(recorder, clock, { rawPoseCount: 0, renderPeopleCount: 0 }, 0);
  clock += STEP_MS;
  tick(recorder, clock);
  assert.ok(STEP_MS * 2 < GAP_MIN_MS, 'the test gap is below the threshold');
  assert.deepEqual(recorder.snapshot(clock).gapHistory, []);
}

// A canvas that simply stops redrawing froze; it did not blank. At ~10Hz that
// must not be reported at the blank threshold, or normal cadence looks like a
// symptom.
{
  const recorder = new PipelineHealthRecorder();
  recorder.reportRender({ source: 'landmarks', available: 1, drawn: 1 }, 1_000);
  const dropped = 1_000 + GAP_MIN_MS + 40;
  assert.ok(dropped - 1_000 < STALE_GAP_MIN_MS, 'one dropped redraw at 10Hz');
  recorder.reportRender({ source: 'landmarks', available: 1, drawn: 1 }, dropped);
  assert.deepEqual(recorder.snapshot(dropped).gapHistory, []);

  const frozen = dropped + STALE_GAP_MIN_MS + 40;
  recorder.reportRender({ source: 'landmarks', available: 1, drawn: 1 }, frozen);
  const [gap] = recorder.snapshot(frozen).gapHistory;
  assert.equal(gap.kind, 'stale');
  assert.equal(gap.layer, 7);
  assert.match(gap.detail, /not redrawn/);
}

// The layer that broke the run keeps the blame even if a later layer fails too.
{
  const recorder = new PipelineHealthRecorder();
  let clock = 1_000;
  tick(recorder, clock);
  clock += STEP_MS;
  for (let index = 0; index < 3; index += 1) {
    tick(recorder, clock, { rawPoseCount: 0, renderPeopleCount: 0 }, 0);
    clock += STEP_MS;
  }
  for (let index = 0; index < 3; index += 1) {
    tick(
      recorder,
      clock,
      {
        sanityAcceptedCount: 0,
        rejectReasons: { too_small: 1 },
        renderPeopleCount: 0,
      },
      0,
    );
    clock += STEP_MS;
  }
  tick(recorder, clock);
  const [gap] = recorder.snapshot(clock).gapHistory;
  assert.equal(gap.layer, 3);
}

// An unconfirmed track only blocks rendering outside simple mode.
{
  const strict = new PipelineHealthRecorder();
  strict.reportFrame(frameReport({ confirmedCount: 0 }), 1_000);
  assert.equal(
    strict.snapshot(1_000).layers.find((entry) => entry.id === 5)?.failCount,
    1,
  );

  const simple = new PipelineHealthRecorder();
  simple.reportFrame(
    frameReport({ confirmedCount: 0, renderRequiresConfirmedTracks: false }),
    1_000,
  );
  simple.reportRender({ source: 'landmarks', available: 1, drawn: 1 }, 1_000);
  assert.equal(simple.snapshot(1_000).lastGap, null);
}

// A stalled camera is attributed to L1, and the gap stays open while it lasts.
{
  const recorder = new PipelineHealthRecorder();
  tick(recorder, 1_000);
  for (let index = 1; index <= 30; index += 1) {
    recorder.reportCapture(
      { readyState: 1, due: true, started: false },
      1_000 + index * 16,
    );
  }
  const at = 1_000 + 30 * 16;
  const snapshot = recorder.snapshot(at);
  assert.ok(snapshot.lastGap);
  assert.equal(snapshot.lastGap!.layer, 1);
  assert.equal(snapshot.lastGap!.open, true);
  assert.equal(snapshot.lastGap!.durationMs, at - 1_000);
  assert.equal(layer(recorder, at, 1).failCount, 30);
  assert.equal(layer(recorder, at, 1).value, '1');
}

// Samples older than the window drop out of the counters.
{
  const recorder = new PipelineHealthRecorder();
  tick(recorder, 1_000, { rawPoseCount: 0, renderPeopleCount: 0 }, 0);
  const later = 1_000 + 11_000;
  tick(recorder, later);
  assert.equal(layer(recorder, later, 3).failCount, 0);
  assert.equal(layer(recorder, later, 3).value, '1');
}

console.log('pipelineHealth.test.ts passed');
