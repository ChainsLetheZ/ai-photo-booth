import { interactionConfig } from '../config/interactionConfig';
import type { BehaviorFeatures } from '../behavior/types';
import type {
  GroupMode,
  PrimaryEnergy,
  SecondaryDimension,
} from '../types';
import {
  getFallbackNarrative,
  type NarrativeOutput,
} from './narrativeFallbacks';

export interface NarrativeMetadata {
  primaryEnergy: PrimaryEnergy;
  secondaryDimension: SecondaryDimension;
  groupSize: number;
  groupMode: GroupMode;
  behavior: Pick<
    BehaviorFeatures,
    | 'groupCohesion'
    | 'movementIntensity'
    | 'movementSynchrony'
    | 'handsConverged'
    | 'armsOpen'
  >;
}

function isNarrativeOutput(value: unknown): value is NarrativeOutput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NarrativeOutput>;
  return (
    typeof candidate.label === 'string' &&
    typeof candidate.response === 'string' &&
    candidate.response.length <= 180 &&
    typeof candidate.directionCopy === 'string' &&
    typeof candidate.imagePromptVariables?.visualTheme === 'string' &&
    typeof candidate.imagePromptVariables?.composition === 'string'
  );
}

export async function generateNarrative(
  metadata: NarrativeMetadata,
): Promise<NarrativeOutput> {
  const fallback = getFallbackNarrative(
    metadata.primaryEnergy,
    metadata.secondaryDimension,
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    interactionConfig.narrativeTimeoutMs,
  );

  try {
    const response = await fetch('/api/narrative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
      signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const output = (await response.json()) as unknown;
    return isNarrativeOutput(output) ? output : fallback;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timeout);
  }
}
