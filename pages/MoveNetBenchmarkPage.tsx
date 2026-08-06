import React, { useEffect, useMemo, useState } from 'react';
import {
  runMoveNetBenchmark,
  type MoveNetBenchmarkResult,
} from '../perception/MoveNetPoseService';

interface BenchmarkState {
  result: MoveNetBenchmarkResult | null;
  error: string | null;
  elapsedMs: number | null;
}

let benchmarkPromise: Promise<BenchmarkState> | null = null;

function requestedF16() {
  const value = new URLSearchParams(window.location.search).get('f16');
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function startBenchmark() {
  if (benchmarkPromise) return benchmarkPromise;
  const startedAt = performance.now();
  benchmarkPromise = runMoveNetBenchmark(100, requestedF16())
    .then((result) => ({
      result,
      error: null,
      elapsedMs: performance.now() - startedAt,
    }))
    .catch((error: unknown) => ({
      result: null,
      error: error instanceof Error ? error.message : 'Benchmark failed.',
      elapsedMs: performance.now() - startedAt,
    }));
  return benchmarkPromise;
}

function metric(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toFixed(2);
}

export default function MoveNetBenchmarkPage() {
  const [state, setState] = useState<BenchmarkState>({
    result: null,
    error: null,
    elapsedMs: null,
  });
  const f16 = useMemo(requestedF16, []);

  useEffect(() => {
    let active = true;
    void startBenchmark().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const result = state.result;
  return (
    <main style={{ minHeight: '100vh', padding: 32, background: '#061016', color: '#dff8ff', fontFamily: 'Courier New, monospace' }}>
      <section style={{ maxWidth: 920, margin: '0 auto' }}>
        <p style={{ color: '#7bd5ef', letterSpacing: '.12em' }}>LOCAL MOVENET DIAGNOSTIC</p>
        <h1>256×256 blank tensor · 100 inference runs</h1>
        <p>No camera, interaction engine, zone logic, halo or debug chart is initialized on this page.</p>
        <p>
          F16 request: <strong>{f16 === undefined ? 'RUNTIME DEFAULT' : String(f16)}</strong>
        </p>
        <nav style={{ display: 'flex', gap: 12, margin: '18px 0 26px' }}>
          <a href="/benchmark?f16=false" style={{ color: '#fff' }}>Reload F16 OFF</a>
          <a href="/benchmark?f16=true" style={{ color: '#fff' }}>Reload F16 ON</a>
          <a href="/booth?debug=true" style={{ color: '#fff' }}>Back to Booth</a>
        </nav>

        {!result && !state.error && <strong data-testid="benchmark-status">RUNNING…</strong>}
        {state.error && <pre data-testid="benchmark-error" style={{ color: '#ff9aa5' }}>{state.error}</pre>}
        {result && (
          <div data-testid="benchmark-result">
            <h2>RESULT</h2>
            <dl style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, maxWidth: 660 }}>
              <dt>MODEL</dt><dd>{result.modelType}</dd>
              <dt>BACKEND</dt><dd>{result.backend}</dd>
              <dt>GPU</dt>
              <dd>
                <strong>{result.gpuRenderer ?? 'UNKNOWN'}</strong>
                <div style={{ color: '#7bd5ef', fontSize: 12, marginTop: 4 }}>
                  Confirm this names the chip you meant to measure before
                  trusting any timing below it.
                </div>
              </dd>
              <dt>WEBGL_PACK</dt><dd>{String(result.webglPack)}</dd>
              <dt>WEBGL_FORCE_F16_TEXTURES</dt><dd>{String(result.webglForceF16Textures)}</dd>
              <dt>WEBGL_VERSION</dt><dd>{result.webglVersion ?? '—'}</dd>
              <dt>ITERATIONS</dt><dd>{result.iterations}</dd>
              <dt>MEDIAN</dt><dd><strong>{metric(result.medianMs)} ms</strong></dd>
              <dt>P95</dt><dd>{metric(result.p95Ms)} ms</dd>
              <dt>MIN / MAX</dt><dd>{metric(result.minMs)} / {metric(result.maxMs)} ms</dd>
              <dt>TENSORS BEFORE INPUT</dt><dd>{result.tensorBeforeInput ?? '—'}</dd>
              <dt>TENSORS AFTER FIRST</dt><dd>{result.tensorAfterFirstRun ?? '—'}</dd>
              <dt>TENSORS AFTER 100</dt><dd>{result.tensorAfterRuns ?? '—'}</dd>
              <dt>TENSORS AFTER DISPOSE</dt><dd>{result.tensorAfterDispose ?? '—'}</dd>
              <dt>TOTAL BENCHMARK WALL</dt><dd>{metric(state.elapsedMs)} ms</dd>
            </dl>
            <pre style={{ marginTop: 28, padding: 18, overflow: 'auto', background: '#02080c', border: '1px solid rgba(123,213,239,.35)' }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </main>
  );
}
