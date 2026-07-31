import { interactionConfig } from '../config/interactionConfig';
import type { HandObservation, PersonObservation } from '../perception/types';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function pointDistance(
  first: { centerX: number; centerY: number },
  second: { centerX: number; centerY: number },
) {
  return Math.hypot(first.centerX - second.centerX, first.centerY - second.centerY);
}

export function analyzeGroup(
  people: PersonObservation[],
  hands: HandObservation[],
) {
  const personDistances: number[] = [];
  for (let first = 0; first < people.length - 1; first += 1) {
    for (let second = first + 1; second < people.length; second += 1) {
      personDistances.push(pointDistance(people[first], people[second]));
    }
  }

  const averagePersonDistance = personDistances.length
    ? average(personDistances)
    : 0;
  const groupCohesion =
    people.length <= 1
      ? 0.5
      : clamp01(1 - averagePersonDistance / 0.58);
  const peopleClose =
    people.length > 1 &&
    averagePersonDistance <= interactionConfig.peopleCloseDistance;

  const handDistances: number[] = [];
  for (let first = 0; first < hands.length - 1; first += 1) {
    for (let second = first + 1; second < hands.length; second += 1) {
      handDistances.push(pointDistance(hands[first], hands[second]));
    }
  }
  const handsConverged =
    handDistances.length > 0 &&
    Math.min(...handDistances) <= interactionConfig.handConvergenceDistance;

  const groupCenter = {
    centerX: average(people.map((person) => person.centerX)),
    centerY: average(people.map((person) => person.centerY)),
  };
  const handsTowardCenter =
    hands.length >= 2 &&
    average(hands.map((hand) => pointDistance(hand, groupCenter))) <=
      interactionConfig.groupHandCentroidDistance;

  return {
    peopleClose,
    groupCohesion,
    handsConverged,
    handsTowardCenter,
  };
}
