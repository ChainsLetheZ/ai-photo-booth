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
  // Resting state: an edge-to-edge panoramic photo field. 20 × 5 makes each
  // cell nearly the same aspect ratio as the uncropped booth portrait inside
  // the master KV's wide strip, while leaving room for a real column offset.
  scroll: {
    columns: 20,
    rows: 5,
    panSeconds: 70,
    tileGapPx: 0,
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
  // The finale. Operator-triggered only — never on a timer or a photo count;
  // it has to land when the room is watching.
  //
  // The existing photo wall contracts into the eight Chinese headline
  // characters, then hands over to the full master KV.
  assemble: {
    // Reserved for any future per-card gather offset.
    staggerMs: 14,
  },
  reconnect: {
    initialDelayMs: 750,
    maxDelayMs: 8000,
  },
} as const;
