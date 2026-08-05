import assert from 'node:assert/strict';
import { simpleMode } from '../config/simpleMode';
import { InteractionStateMachine } from '../interaction/InteractionStateMachine';
import {
  SimpleFlowController,
  type SimpleFlowInput,
} from '../interaction/SimpleFlowController';

const none: SimpleFlowInput = {
  personDetected: false,
  handRaised: false,
  handSide: null,
  gestureConfirmed: false,
};
const person: SimpleFlowInput = { ...none, personDetected: true };
const raised: SimpleFlowInput = {
  ...person,
  handRaised: true,
  handSide: 'left',
};

function flow() {
  return new SimpleFlowController(simpleMode);
}

{
  const subject = flow();
  assert.equal(subject.update(0, person).state, 'PERCEIVING');
}

{
  const subject = flow();
  subject.update(0, person);
  for (let frame = 1; frame <= 100; frame += 1) {
    const snapshot = subject.update(frame * 50, none);
    assert.notEqual(snapshot.state, 'IDLE');
  }
  assert.equal(subject.getSnapshot(5000).state, 'LOCKED');
  assert.equal(subject.getSnapshot(5000).ringProgress, 1);
}

{
  const subject = flow();
  subject.update(0, person);
  assert.equal(subject.update(4999, none).state, 'PERCEIVING');
  assert.equal(subject.update(5000, none).state, 'LOCKED');
}

{
  const subject = flow();
  subject.update(0, raised);
  const accelerated = subject.update(1250, raised);
  assert.equal(accelerated.baseRatePerSec, 0.2);
  assert.equal(accelerated.boostRatePerSec, 0.6);
  assert.equal(accelerated.state, 'LOCKED');
}

{
  const subject = flow();
  subject.update(0, person);
  const confirmed = subject.update(100, {
    ...person,
    gestureConfirmed: true,
  });
  assert.equal(confirmed.ringProgress, 1);
  assert.equal(confirmed.state, 'LOCKED');
}

{
  const subject = flow();
  subject.update(0, raised);
  const boosted = subject.update(500, raised).ringProgress;
  const released = subject.update(1000, person).ringProgress;
  assert.ok(released >= boosted, 'Ring progress must never decrease');
}

for (const changedInput of [
  { ...person },
  { ...none },
]) {
  const subject = flow();
  subject.manualShutter(0);
  assert.equal(subject.getSnapshot(0).state, 'COUNTDOWN');
  assert.equal(subject.update(3000, changedInput).state, 'CAPTURE');
}

{
  const idle = flow();
  assert.equal(idle.manualShutter(0).state, 'COUNTDOWN');
  const perceiving = flow();
  perceiving.update(0, person);
  assert.equal(perceiving.manualShutter(250).state, 'COUNTDOWN');
}

{
  const subject = flow();
  subject.manualShutter(0);
  subject.update(3000, none);
  subject.generationComplete(3300);
  assert.equal(subject.getSnapshot(3300).state, 'RESULT');
  assert.equal(subject.update(8300, person).state, 'IDLE');
  assert.ok(subject.getSnapshot(8300).cooldownRemainingMs > 0);
  assert.equal(subject.update(10_000, person).state, 'IDLE');
  assert.equal(subject.update(11_300, person).state, 'PERCEIVING');
}

{
  const subject = flow();
  subject.update(0, raised);
  subject.update(500, raised);
  const reset = subject.resetSession(600);
  assert.equal(reset.state, 'IDLE');
  assert.equal(reset.ringProgress, 0);
  assert.equal(reset.handRaised, false);
  assert.equal(reset.handSide, null);
  assert.equal(reset.gestureConfirmed, false);
  assert.equal(reset.personPresent, false);
  assert.equal(reset.countdown, null);
}

{
  assert.equal(simpleMode.enabled, true);
  const strict = new InteractionStateMachine();
  strict.dispatch('CAPTURE_ZONE_ENTERED');
  strict.dispatch('START_DIRECT');
  assert.equal(strict.getState(), 'DIRECT');
  assert.equal(
    strict.dispatch('CAPTURE_INVALID'),
    'CAPTURE_ZONE',
    'The original strict-mode backtracking path must remain intact',
  );
}

console.log('Simple flow tests passed.');

