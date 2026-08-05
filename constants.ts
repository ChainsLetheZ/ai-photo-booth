import type { GroupMode, PrimaryEnergy, SecondaryDimension } from './types';

export const LOCAL_STORAGE_KEY = 'bosch_future_portraits_v1';

export const EVENT = {
  eyebrow: 'BOSCH SUPPLIER CONFERENCE',
  title: 'AI Future Portraits',
  wallTitle: 'The Future We Create Together',
} as const;

/** Supplier Day 2026 KV slogan — the shape the wall assembles into. */
export const EVENT_SLOGAN = {
  primary: '竞速智联 共塑致远',
  secondary: 'Accelerate Innovation · Go Beyond Together',
} as const;

export const ENERGY_CONFIG: Record<
  PrimaryEnergy,
  { number: string; label: string; description: string; color: string; accent: string }
> = {
  Motion: {
    number: '01',
    label: 'MOTION',
    description: 'Flow · speed · dynamic systems',
    color: '#00629A',
    accent: '#00A8E0',
  },
  Intelligence: {
    number: '02',
    label: 'INTELLIGENCE',
    description: 'Insight · precision · automation',
    color: '#50237F',
    accent: '#9E56A2',
  },
  Life: {
    number: '03',
    label: 'LIFE',
    description: 'People · connection · experience',
    color: '#18837E',
    accent: '#2FB9AD',
  },
  Impact: {
    number: '04',
    label: 'IMPACT',
    description: 'Responsibility · lasting value',
    color: '#00884A',
    accent: '#7AB51D',
  },
};

export const SECONDARY_COPY: Record<SecondaryDimension, string> = {
  Collaboration: 'Your shared rhythm turns individual signals into collective intelligence.',
  Precision: 'Your calm alignment transforms intention into systems built with clarity.',
  Momentum: 'Your energy creates forward motion and brings the next possibility closer.',
  Exploration: 'Your open stance reveals new paths where people and technology can meet.',
};

export const DIRECTION_COPY: Record<
  GroupMode,
  { headline: string; instruction: string; support: string }
> = {
  Single: {
    headline: 'Create your signal',
    instruction: 'Lift one arm diagonally. Open your other hand toward the future.',
    support: 'Make one clear movement, then hold the pose.',
  },
  Pair: {
    headline: 'Connect your signals',
    instruction: 'Turn slightly inward. Reach one open hand toward the space between you.',
    support: 'Move together, then hold your shared frame.',
  },
  Group: {
    headline: 'Build a collective field',
    instruction: 'Form an open arc. Raise one hand toward the center as one team.',
    support: 'Keep faces visible and hold the group shape.',
  },
};

export const PRINT_6INCH_SERVER = {
  width: 1800,
  height: 1200,
  media: '6x4',
} as const;
