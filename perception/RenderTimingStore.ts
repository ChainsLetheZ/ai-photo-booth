const MAX_SAMPLE_AGE_MS = 250;

interface RenderSample {
  durationMs: number;
  timestamp: number;
}

const samples = new Map<string, RenderSample>();

export function recordRenderTiming(
  source: 'halo' | 'landmarks' | 'probeChart',
  durationMs: number,
  timestamp = performance.now(),
) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  samples.set(source, { durationMs, timestamp });
}

export function latestRenderMs(timestamp = performance.now()) {
  let total = 0;
  samples.forEach((sample) => {
    if (timestamp - sample.timestamp <= MAX_SAMPLE_AGE_MS) {
      total += sample.durationMs;
    }
  });
  return total;
}

export function resetRenderTiming() {
  samples.clear();
}
