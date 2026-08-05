export const wallConfig = {
  capacity: 200,
  firstShortCode: 101,
  persistenceFile: 'data/wall-entries.json',
  localFallbackKey: 'bosch_collective_wall_v2',
  reservationFallbackKey: 'bosch_collective_wall_codes_v2',
  websocketPath: '/api/wall/ws',
  layout: {
    referenceWidthPx: 1920,
    referenceHeightPx: 1080,
    columns: 20,
    rows: 10,
    cellWidthPx: 106,
    cellHeightPx: 83,
    cellGapPx: 5,
    placeholderOpacity: 0.04,
    standbyGlowOpacity: 0.07,
    standbyGlowPeriodMs: 2000,
    standbyGlowMinSlots: 3,
    standbyGlowMaxSlots: 5,
  },
  breathing: {
    amplitudePx: 3,
    periodMsMin: 4000,
    periodMsMax: 6500,
    scaleAmplitude: 0.015,
  },
  joinAnimation: {
    recedeMs: 600,
    enterMs: 1200,
    perceptionMs: 1500,
    labelMs: 1500,
    holdMs: 2000,
    settleMs: 1500,
    rippleMs: 1000,
    multiPersonStaggerMs: 150,
    queueBusyThreshold: 3,
    queueRushThreshold: 6,
  },
  // Resting state of the wall: a slow diagonal river of large photos. Faces
  // read across the room, so the tile count is deliberately low. Photos repeat
  // to fill the field — position carries no identity here, the register does.
  scroll: {
    columns: 4,
    rows: 3,
    panSeconds: 150,
    tileGapPx: 10,
    fadeMs: 900,
  },
  // Reached only while a new capture is joining: the river breaks into floating
  // tiles, gathers into the register, then goes back to the river.
  drift: {
    spread: 0.42,
    periodMsMin: 9000,
    periodMsMax: 15000,
    amplitudePx: 26,
    returnMs: 1100,
    // The new photo floats on its own before the wall reassembles around it.
    arrivalDriftMs: 2200,
    // How long the register stays formed after the newcomer has settled.
    holdMs: 4000,
  },
  // Photos flying into the slogan. Operator-triggered only — never on a timer
  // or a photo count; it has to land when the room is watching.
  assemble: {
    sampleWidth: 960,
    sampleHeight: 540,
    sampleStep: 5,
    alphaThreshold: 140,
    // A tile wider than a stroke turns the glyph into a blob, so this caps how
    // far tiles may grow when the photo count is low. Scaling the whole slogan
    // down does not help: ink area and stroke width shrink together, so the
    // number of photos a phrase needs is a property of the phrase, not its size.
    strokeTileRatio: 1.5,
    minTilePx: 16,
    flightMs: 1600,
    staggerMs: 14,
    // Richest first. The wall drops to a shorter phrase rather than draw a
    // long one out of too few photos. Measured on this machine's fonts, the
    // ladder needs roughly 127 / 81 / 43 / 21 / 14 photos — but the numbers are
    // recomputed at run time, because the venue machine may substitute fonts.
    targets: [
      {
        primary: '竞速智联 共塑致远',
        secondary: 'Accelerate Innovation · Go Beyond Together',
      },
      { primary: '竞速智联 共塑致远', secondary: '' },
      { primary: '竞速智联', secondary: '' },
      { primary: 'UX ML4', secondary: '' },
      { primary: 'ML4', secondary: '' },
    ],
  },
  lookup: {
    holdMs: 8000,
    notFoundMs: 2000,
  },
  reconnect: {
    initialDelayMs: 750,
    maxDelayMs: 8000,
  },
} as const;
