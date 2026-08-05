import React, { useEffect, useState } from 'react';
import {
  formatGap,
  formatGapHistory,
  formatHealthReport,
  formatSession,
  pipelineHealth,
  type PipelineHealthSnapshot,
} from '../perception/PipelineHealthStore';

const REFRESH_MS = 200;

export default function PipelineHealthPanel() {
  const [health, setHealth] = useState<PipelineHealthSnapshot>(() =>
    pipelineHealth.snapshot(),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(
      () => setHealth(pipelineHealth.snapshot()),
      REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const copyReport = async () => {
    const report = formatHealthReport(pipelineHealth.snapshot());
    console.info(report);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard is blocked without a secure context; the console copy stands.
      setCopied(false);
    }
  };

  return (
    <div className="debug-pipeline" data-testid="pipeline-health">
      <strong>
        PIPELINE HEALTH ({Math.round(health.windowMs / 1000)}s)
        <button type="button" onClick={copyReport}>
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </strong>
      <ul>
        {health.layers.map((layer) => (
          <li key={layer.id} className={layer.failCount ? 'has-fail' : ''}>
            <span>
              {layer.id}. {layer.label}
            </span>
            <b>{layer.value}</b>
            <i>
              {layer.failLabel}: {layer.failCount}
            </i>
            {layer.detail && <em>{layer.detail}</em>}
          </li>
        ))}
      </ul>
      <p data-testid="pipeline-session">
        SESSION: {formatSession(health.session)}
      </p>
      <p
        className={health.lastGap?.open ? 'is-open' : ''}
        data-testid="pipeline-last-gap"
      >
        LAST GAP: {formatGap(health.lastGap)}
      </p>
      <p data-testid="pipeline-gap-history">
        GAP HISTORY: {formatGapHistory(health.gapHistory)}
      </p>
    </div>
  );
}
