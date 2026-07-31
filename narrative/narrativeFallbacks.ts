import type { PrimaryEnergy, SecondaryDimension } from '../types';

export interface NarrativeOutput {
  label: string;
  response: string;
  directionCopy: string;
  imagePromptVariables: {
    visualTheme: string;
    composition: string;
  };
}

type NarrativeMatrix = Record<
  PrimaryEnergy,
  Record<SecondaryDimension, NarrativeOutput>
>;

function narrative(
  primary: PrimaryEnergy,
  secondary: SecondaryDimension,
  response: string,
  visualTheme: string,
  composition: string,
): NarrativeOutput {
  return {
    label: `${primary} × ${secondary}`,
    response,
    directionCopy:
      secondary === 'Collaboration'
        ? 'Bring your energy together.'
        : secondary === 'Momentum'
          ? 'Open the frame and move with purpose.'
          : secondary === 'Exploration'
            ? 'Reach beyond the familiar.'
            : 'Hold the signal with clarity.',
    imagePromptVariables: { visualTheme, composition },
  };
}

export const fallbackNarratives: NarrativeMatrix = {
  Motion: {
    Collaboration: narrative(
      'Motion',
      'Collaboration',
      'Many movements. One forward rhythm.',
      'interconnected blue kinetic trails',
      'subjects linked by a shared directional flow',
    ),
    Precision: narrative(
      'Motion',
      'Precision',
      'Every movement finds its exact path.',
      'engineered blue motion lines',
      'crisp radial geometry around the subjects',
    ),
    Momentum: narrative(
      'Motion',
      'Momentum',
      'Your energy turns possibility into progress.',
      'high-velocity cyan energy',
      'forward sweeping composition with controlled blur',
    ),
    Exploration: narrative(
      'Motion',
      'Exploration',
      'New directions begin with the courage to move.',
      'branching blue trajectories',
      'open asymmetric space with multiple pathways',
    ),
  },
  Intelligence: {
    Collaboration: narrative(
      'Intelligence',
      'Collaboration',
      'Connected minds. One future.',
      'violet neural connections',
      'shared luminous intelligence core',
    ),
    Precision: narrative(
      'Intelligence',
      'Precision',
      'Clear signals become confident decisions.',
      'violet computational geometry',
      'balanced technical grid with sharp focal light',
    ),
    Momentum: narrative(
      'Intelligence',
      'Momentum',
      'Insight accelerates what comes next.',
      'fast violet data streams',
      'layered signals moving toward a clear horizon',
    ),
    Exploration: narrative(
      'Intelligence',
      'Exploration',
      'Curiosity expands the intelligence of every system.',
      'violet discovery constellations',
      'expanding nodes around an open center',
    ),
  },
  Life: {
    Collaboration: narrative(
      'Life',
      'Collaboration',
      'Human connection gives technology its purpose.',
      'teal living networks',
      'warm connected portrait cluster',
    ),
    Precision: narrative(
      'Life',
      'Precision',
      'Care becomes visible in every considered detail.',
      'refined teal organic structures',
      'calm centered composition with delicate layers',
    ),
    Momentum: narrative(
      'Life',
      'Momentum',
      'Shared energy makes everyday progress feel alive.',
      'flowing teal vitality',
      'uplifting movement through human-centered space',
    ),
    Exploration: narrative(
      'Life',
      'Exploration',
      'New experiences grow where people stay open.',
      'teal bioluminescent pathways',
      'organic branches opening around the subjects',
    ),
  },
  Impact: {
    Collaboration: narrative(
      'Impact',
      'Collaboration',
      'Lasting change is built together.',
      'green collective energy field',
      'many signals converging into one durable form',
    ),
    Precision: narrative(
      'Impact',
      'Precision',
      'Focused choices create value that endures.',
      'precise green material layers',
      'strong architectural balance and clear edges',
    ),
    Momentum: narrative(
      'Impact',
      'Momentum',
      'Purpose in motion becomes measurable change.',
      'green accelerating energy',
      'upward trajectory with a grounded center',
    ),
    Exploration: narrative(
      'Impact',
      'Exploration',
      'The next sustainable path starts by seeing differently.',
      'green future ecosystems',
      'wide horizon with emerging circular pathways',
    ),
  },
};

export function getFallbackNarrative(
  primary: PrimaryEnergy,
  secondary: SecondaryDimension,
) {
  return fallbackNarratives[primary][secondary];
}
