import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BodyScaleZoneDecision,
  type BodyScaleDecisionSnapshot,
} from '../interaction/BodyScaleZoneDecision';

function prime(
  decision: BodyScaleZoneDecision,
  scale = 100,
  startMs = 0,
  stepMs = 100,
) {
  let snapshot: BodyScaleDecisionSnapshot | null = null;
  let timestampMs = startMs;
  for (let index = 0; index < 5; index += 1) {
    snapshot = decision.update({ timestampMs, filtScale: scale, postureValid: true });
    timestampMs += stepMs;
  }
  assert.ok(snapshot?.baseline !== null, 'Five stable frames initialize baseline');
  return { timestampMs, snapshot: snapshot! };
}

const stable = new BodyScaleZoneDecision();
let stableClock = prime(stable).timestampMs;
for (let index = 0; index < 50; index += 1) {
  const snapshot = stable.update({
    timestampMs: stableClock,
    filtScale: 100,
    postureValid: true,
  });
  assert.equal(snapshot.zone, 'Z1');
  assert.ok(snapshot.g !== null && Math.abs(snapshot.g - 1) < 1e-9);
  stableClock += 100;
}

const enter = new BodyScaleZoneDecision();
let enterClock = prime(enter).timestampMs;
let enterSnapshot = enter.getSnapshot();
for (let index = 0; index < 6; index += 1) {
  enterSnapshot = enter.update({
    timestampMs: enterClock,
    filtScale: 106,
    postureValid: true,
  });
  enterClock += 100;
}
assert.equal(enterSnapshot.zone, 'Z1', '0.6 seconds is not enough to enter Z2');
enterSnapshot = enter.update({
  timestampMs: enterClock,
  filtScale: 106,
  postureValid: true,
});
enterClock += 100;
assert.equal(enterSnapshot.zone, 'Z2', '0.7 seconds at g=1.06 enters Z2');

const frozenBaseline = enterSnapshot.baseline;
for (let index = 0; index < 200; index += 1) {
  enterSnapshot = enter.update({
    timestampMs: enterClock,
    filtScale: 106,
    postureValid: true,
  });
  enterClock += 50;
}
assert.equal(enterSnapshot.zone, 'Z2');
assert.equal(enterSnapshot.baselineFrozen, true);
assert.equal(enterSnapshot.baseline, frozenBaseline);
assert.ok(enterSnapshot.g !== null && enterSnapshot.g > 1.05);

for (let index = 0; index < 5; index += 1) {
  enterSnapshot = enter.update({
    timestampMs: enterClock,
    filtScale: 101,
    postureValid: true,
  });
  enterClock += 50;
}
assert.equal(enterSnapshot.zone, 'Z2', '0.25 seconds is not enough to exit Z2');
enterSnapshot = enter.update({
  timestampMs: enterClock,
  filtScale: 101,
  postureValid: true,
});
enterClock += 50;
assert.equal(enterSnapshot.zone, 'Z1', '0.3 seconds at g=1.01 exits Z2');

const deadband = new BodyScaleZoneDecision();
let deadbandClock = prime(deadband).timestampMs;
const deadbandCredit = deadband.getSnapshot().credit;
for (let index = 0; index < 50; index += 1) {
  const snapshot = deadband.update({
    timestampMs: deadbandClock,
    filtScale: 103,
    postureValid: true,
  });
  deadbandClock += 100;
  assert.equal(snapshot.zone, 'Z1');
  assert.equal(snapshot.credit, deadbandCredit, 'Deadband must hold credit');
}

const tolerant = new BodyScaleZoneDecision();
let tolerantClock = prime(tolerant).timestampMs;
let tolerantSnapshot = tolerant.getSnapshot();
for (let index = 0; index < 4; index += 1) {
  tolerantSnapshot = tolerant.update({
    timestampMs: tolerantClock,
    filtScale: 106,
    postureValid: true,
  });
  tolerantClock += 100;
}
const creditBeforeBadFrames = tolerantSnapshot.credit;
for (let index = 0; index < 2; index += 1) {
  tolerantSnapshot = tolerant.update({
    timestampMs: tolerantClock,
    filtScale: 98,
    postureValid: true,
  });
  tolerantClock += 50;
}
assert.ok(tolerantSnapshot.credit < creditBeforeBadFrames);
assert.ok(tolerantSnapshot.credit > -1);
for (let index = 0; index < 20 && tolerantSnapshot.zone !== 'Z2'; index += 1) {
  tolerantSnapshot = tolerant.update({
    timestampMs: tolerantClock,
    filtScale: 106,
    postureValid: true,
  });
  tolerantClock += 100;
}
assert.equal(tolerantSnapshot.zone, 'Z2', 'Two bad frames do not prevent entry');

const postureGate = new BodyScaleZoneDecision();
let postureClock = prime(postureGate).timestampMs;
for (let index = 0; index < 3; index += 1) {
  postureGate.update({
    timestampMs: postureClock,
    filtScale: 106,
    postureValid: true,
  });
  postureClock += 100;
}
const beforeInvalid = postureGate.getSnapshot(postureClock);
for (let index = 0; index < 20; index += 1) {
  postureGate.update({
    timestampMs: postureClock,
    filtScale: 60,
    postureValid: false,
  });
  postureClock += 100;
}
const duringInvalid = postureGate.getSnapshot(postureClock);
assert.equal(duringInvalid.zone, beforeInvalid.zone);
assert.equal(duringInvalid.baseline, beforeInvalid.baseline);
assert.equal(duringInvalid.credit, beforeInvalid.credit);
assert.equal(duringInvalid.baselineFrozen, beforeInvalid.baselineFrozen);
assert.ok(duringInvalid.postureInvalidForMs >= 1500);
for (let index = 0; index < 20 && duringInvalid.zone !== 'Z2'; index += 1) {
  const recovered = postureGate.update({
    timestampMs: postureClock,
    filtScale: 106,
    postureValid: true,
  });
  postureClock += 100;
  Object.assign(duringInvalid, recovered);
}
assert.equal(duringInvalid.zone, 'Z2', 'Voting resumes when posture becomes valid');

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

const fixtureText = readFileSync(
  new URL('./fixtures/v2_step_forward.csv', import.meta.url),
  'utf8',
).trim();
const fixtureLines = fixtureText.split(/\r?\n/);
const fixtureHeaders = parseCsvLine(fixtureLines[0]);
const fixtureRows = fixtureLines.slice(1).map((line) => {
  const values = parseCsvLine(line);
  return Object.fromEntries(
    fixtureHeaders.map((header, index) => [header, values[index] ?? '']),
  );
});
const replay = new BodyScaleZoneDecision();
let replayZone = replay.getSnapshot().zone;
let replayEnters = 0;
let replayExits = 0;
const replayTransitions: Array<{ timestampMs: number; zone: string; scale: number }> = [];
for (const row of fixtureRows) {
  if (!row.filt_scale) continue;
  const snapshot = replay.update({
    timestampMs: Number(row.timestamp_ms),
    filtScale: Number(row.filt_scale),
    postureValid: row.posture_valid !== 'false',
  });
  if (snapshot.zone !== replayZone) {
    if (snapshot.zone === 'Z2') replayEnters += 1;
    else replayExits += 1;
    replayTransitions.push({
      timestampMs: Number(row.timestamp_ms),
      zone: snapshot.zone,
      scale: Number(row.filt_scale),
    });
    replayZone = snapshot.zone;
  }
}
assert.equal(replayEnters, 5, 'Real replay contains exactly five Z1→Z2 entries');
assert.equal(
  replayExits,
  4,
  'The supplied recording stops during the fifth near hold, after four returns',
);
assert.equal(replayZone, 'Z2');
assert.equal(
  replayTransitions.length,
  9,
  'The real sequence produces no extra zone flips',
);

// The supplied file ends before the fifth retreat. Complete only that missing
// tail with an already-recorded far plateau from the same CSV and camera setup.
const recordedFarTail = fixtureRows.filter((row) => {
  const timestamp = Number(row.timestamp_ms);
  return timestamp >= 29156 && timestamp <= 30000 && row.filt_scale;
});
let completedClock = Number(fixtureRows.at(-1)?.timestamp_ms ?? 0);
for (const row of recordedFarTail) {
  completedClock += 100;
  const snapshot = replay.update({
    timestampMs: completedClock,
    filtScale: Number(row.filt_scale),
    postureValid: row.posture_valid !== 'false',
  });
  if (snapshot.zone !== replayZone) {
    if (snapshot.zone === 'Z2') replayEnters += 1;
    else replayExits += 1;
    replayZone = snapshot.zone;
  }
}
assert.equal(replayEnters, 5);
assert.equal(replayExits, 5, 'A complete fifth retreat produces the fifth exit');

console.log('Zone decision tests passed.');
