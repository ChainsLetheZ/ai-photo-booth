import React, { useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../components/BrandBar';
import SignalField from '../components/SignalField';
import PerceptionDebugOverlay from '../debug/PerceptionDebugOverlay';
import {
  BrowserCameraService,
  blobToDataUrl,
  type CameraStatus,
} from '../camera/CameraService';
import {
  DIRECTION_COPY,
  ENERGY_CONFIG,
  EVENT,
} from '../constants';
import { interactionConfig } from '../config/interactionConfig';
import {
  InteractionController,
  type InteractionEngineSnapshot,
} from '../interaction/InteractionController';
import { getFallbackNarrative } from '../narrative/narrativeFallbacks';
import {
  generateNarrative,
  type NarrativeMetadata,
} from '../narrative/NarrativeService';
import { publishPortrait } from '../services/portraitStore';
import { renderFuturePortrait } from '../services/portraitRenderer';
import type {
  BehaviorReading,
  PortraitRecord,
  PrimaryEnergy,
} from '../types';

const ENERGY_ORDER = Object.keys(ENERGY_CONFIG) as PrimaryEnergy[];

function makeFallbackCapture(primary: PrimaryEnergy | null) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 960;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#153B55');
  gradient.addColorStop(1, primary ? ENERGY_CONFIG[primary].color : '#00629A');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255,255,255,.1)';
  context.beginPath();
  context.arc(640, 410, 180, 0, Math.PI * 2);
  context.fill();
  context.fillRect(350, 590, 580, 420);
  context.fillStyle = '#FFFFFF';
  context.font = '600 34px Arial';
  context.textAlign = 'center';
  context.fillText('CAMERA PREVIEW', 640, 875);
  return canvas.toDataURL('image/jpeg', 0.9);
}

export default function BoothPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [engine, setEngine] = useState<InteractionEngineSnapshot | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<PortraitRecord | null>(null);
  const [resultNarrative, setResultNarrative] = useState('');
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraService | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const publishedIdRef = useRef<string | null>(null);
  const generationStartedRef = useRef(false);
  const debug = useMemo(
    () => new URLSearchParams(window.location.search).get('debug') === 'true',
    [],
  );

  const state = engine?.state ?? 'IDLE';
  const primary = engine?.primary ?? null;
  const secondary = engine?.secondary ?? null;
  const mode = engine?.mode ?? 'Single';
  const features = engine?.features;
  const peopleCount = features?.personCount ?? 0;
  const activeColor = primary ? ENERGY_CONFIG[primary].color : '#00629A';
  const direction = DIRECTION_COPY[mode];
  const responseNarrative =
    primary && secondary ? getFallbackNarrative(primary, secondary) : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const camera = new BrowserCameraService(video);
    const controller = new InteractionController(video, setEngine);
    cameraRef.current = camera;
    controllerRef.current = controller;
    setEngine(controller.getSnapshot());

    let cancelled = false;
    camera
      .start()
      .then(async () => {
        if (cancelled) return;
        setCameraStatus(camera.getStatus());
        controller.cameraReady();
        try {
          await controller.start();
        } catch {
          // Camera and touch fallback remain fully usable without MediaPipe.
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCameraStatus(camera.getStatus());
      });

    return () => {
      cancelled = true;
      controller.close();
      camera.stop();
    };
  }, []);

  useEffect(() => {
    if (state !== 'ANALYZING_BEHAVIOR') return undefined;
    const timer = window.setTimeout(
      () => controllerRef.current?.completeAnalysis(),
      interactionConfig.analysisDurationMs,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'AI_RESPONSE') return undefined;
    const timer = window.setTimeout(
      () => controllerRef.current?.completeResponse(),
      interactionConfig.responseDurationMs,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'ACTION_INSTRUCTION') return undefined;
    const timer = window.setTimeout(
      () => controllerRef.current?.beginActionTracking(),
      interactionConfig.instructionLeadInMs,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'POSE_READY') return undefined;
    const timer = window.setTimeout(
      () => controllerRef.current?.beginCountdown(),
      interactionConfig.readyHoldMs,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'COUNTDOWN') return undefined;
    setCountdown(3);
    let current = 3;
    const timer = window.setInterval(() => {
      current -= 1;
      if (current <= 0) {
        window.clearInterval(timer);
        controllerRef.current?.countdownComplete();
      } else {
        setCountdown(current);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'CAPTURE') return;
    let cancelled = false;
    const capture = async () => {
      try {
        const camera = cameraRef.current;
        const dataUrl =
          camera?.getStatus() === 'ready'
            ? await blobToDataUrl(await camera.captureFrame())
            : makeFallbackCapture(primary);
        if (cancelled) return;
        setCapturedImage(dataUrl);
        generationStartedRef.current = false;
        controllerRef.current?.captureComplete();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Capture failed.');
        controllerRef.current?.fail();
      }
    };
    capture();
    return () => {
      cancelled = true;
    };
  }, [state, primary]);

  useEffect(() => {
    if (
      state !== 'GENERATING' ||
      !capturedImage ||
      !primary ||
      !secondary ||
      generationStartedRef.current
    ) {
      return;
    }
    const generationEngine = controllerRef.current?.getSnapshot();
    if (!generationEngine) return;
    generationStartedRef.current = true;
    let cancelled = false;

    const generate = async () => {
      try {
        const metadata: NarrativeMetadata = {
          primaryEnergy: primary,
          secondaryDimension: secondary,
          groupSize: Math.max(1, generationEngine.features.personCount),
          groupMode: generationEngine.mode,
          behavior: {
            groupCohesion: generationEngine.features.groupCohesion,
            movementIntensity: generationEngine.features.movementIntensity,
            movementSynchrony: generationEngine.features.movementSynchrony,
            handsConverged: generationEngine.features.handsConverged,
            armsOpen: generationEngine.features.armsOpen,
          },
        };
        const narrative = await generateNarrative(metadata);
        const reading: BehaviorReading = {
          peopleCount: metadata.groupSize,
          mode: generationEngine.mode,
          movement: generationEngine.features.movementIntensity,
          stability: generationEngine.features.stability,
          cohesion: generationEngine.features.groupCohesion,
          secondary,
        };
        const result = await renderFuturePortrait(
          capturedImage,
          primary,
          reading,
          narrative.response,
        );
        if (cancelled) return;
        setResultNarrative(narrative.response);
        setPortrait(result);
        controllerRef.current?.generationComplete();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Unable to create the portrait.',
        );
        controllerRef.current?.fail();
      }
    };
    generate();
    return () => {
      cancelled = true;
    };
  }, [state, capturedImage, primary, secondary]);

  useEffect(() => {
    if (
      state !== 'RESULT' ||
      !portrait ||
      publishedIdRef.current === portrait.id
    ) {
      return;
    }
    publishedIdRef.current = portrait.id;
    controllerRef.current?.beginCollectivePush();
    publishPortrait(portrait).finally(() => {
      controllerRef.current?.collectiveComplete();
    });
  }, [state, portrait]);

  const restart = () => {
    publishedIdRef.current = null;
    generationStartedRef.current = false;
    setCapturedImage(null);
    setPortrait(null);
    setResultNarrative('');
    setError('');
    controllerRef.current?.reset();
  };

  const isIdle =
    state === 'IDLE' ||
    state === 'PARTICIPANT_DETECTED' ||
    state === 'AWAITING_START';
  const isDirection =
    state === 'ACTION_INSTRUCTION' ||
    state === 'ACTION_TRACKING' ||
    state === 'POSE_READY';
  const isCreating =
    state === 'CAPTURE' || state === 'GENERATING';
  const isResult =
    state === 'RESULT' ||
    state === 'COLLECTIVE_PUSH' ||
    state === 'COMPLETE';

  return (
    <main className="booth-shell" style={{ '--active': activeColor } as React.CSSProperties}>
      <BrandBar />
      <section className="camera-stage">
        <video ref={videoRef} muted playsInline className="camera-feed" />
        <div className="camera-vignette" />
        <div className="camera-grid" />

        {!isIdle && !isResult && (
          <div className="live-readout">
            <span className={`status-dot ${engine?.perception.status === 'running' ? '' : 'muted'}`} />
            {engine?.perception.status === 'running'
              ? 'MEDIAPIPE ACTIVE'
              : 'TOUCH FALLBACK'}
            <i />
            {peopleCount} {peopleCount === 1 ? 'PERSON' : 'PEOPLE'}
          </div>
        )}

        {isIdle && (
          <div className="idle-panel">
            <div className="presence-pill">
              <span className={cameraStatus === 'ready' ? 'status-dot' : 'status-dot muted'} />
              {peopleCount > 1
                ? 'I see a team forming.'
                : peopleCount === 1
                  ? 'A new signal is in view.'
                  : cameraStatus === 'ready'
                    ? 'Step into the interaction area.'
                    : cameraStatus === 'starting'
                      ? 'Preparing local AI vision…'
                      : 'Camera unavailable · touch demo ready'}
            </div>
            <p className="kicker">{EVENT.eyebrow}</p>
            <h1>
              Bring your intention.
              <br />
              <em>Meet your future.</em>
            </h1>
            <p className="intro">
              Make one choice. Local AI vision will read how you move together,
              direct your pose, and co-create a future portrait.
            </p>
            <button
              className="primary-button"
              onClick={() => controllerRef.current?.startExperience()}
            >
              Begin experience <span>→</span>
            </button>
            <p className="privacy-note">
              Live perception stays on this device. Only the final intended photo is captured.
            </p>
          </div>
        )}

        {state === 'PRIMARY_SELECTION' && (
          <div className="select-panel">
            <p className="step-label">01 · HUMAN INPUT</p>
            <h2>What energy do you bring<br />to the future?</h2>
            <p>Choose one. Your intention leads the experience.</p>
            <div className="energy-grid">
              {ENERGY_ORDER.map((energy) => {
                const item = ENERGY_CONFIG[energy];
                return (
                  <button
                    key={energy}
                    className="energy-card"
                    style={{ '--energy': item.color, '--energy-accent': item.accent } as React.CSSProperties}
                    onClick={() => controllerRef.current?.selectPrimary(energy)}
                  >
                    <span>{item.number}</span>
                    <i />
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                    <b>↗</b>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {state === 'ANALYZING_BEHAVIOR' && (
          <div className="center-panel reading-panel">
            <SignalField active />
            <p className="step-label">02 · LOCAL AI READ</p>
            <h2>Reading your<br />shared signal</h2>
            <p>Observing group rhythm · movement · alignment</p>
            <div className="read-bars">
              <span><i style={{ width: `${Math.min(100, 18 + (features?.movementIntensity ?? 0) * 120)}%` }} /></span>
              <span><i style={{ width: `${Math.min(100, 20 + (features?.stability ?? 0) * 75)}%` }} /></span>
              <span><i style={{ width: `${Math.min(100, 20 + (features?.groupCohesion ?? 0) * 75)}%` }} /></span>
            </div>
          </div>
        )}

        {state === 'AI_RESPONSE' && primary && secondary && responseNarrative && (
          <div className="center-panel response-panel">
            <p className="step-label">03 · AI RESPONSE</p>
            <div className="detected-lockup">
              <span>{primary.toUpperCase()}</span>
              <b>×</b>
              <span>{secondary.toUpperCase()}</span>
            </div>
            <h2>Signal detected.</h2>
            <p>{responseNarrative.response}</p>
            <div className="activation-line"><i /> Activating your future scenario…</div>
          </div>
        )}

        {isDirection && (
          <div className="direction-layout">
            <div className="pose-frame">
              <span className="corner top-left" />
              <span className="corner top-right" />
              <span className="corner bottom-left" />
              <span className="corner bottom-right" />
              <SignalField active />
            </div>
            <aside className="director-card">
              <p className="step-label">04 · AI DIRECTOR · {mode.toUpperCase()}</p>
              <h2>{state === 'POSE_READY' ? 'Perfect. Ready?' : direction.headline}</h2>
              <p className="direction-copy">{direction.instruction}</p>
              <small>{direction.support}</small>
              <div className="ready-meter">
                <div>
                  <i
                    style={{
                      width: `${state === 'POSE_READY' ? 100 : Math.round((engine?.stability.progress ?? 0) * 100)}%`,
                    }}
                  />
                </div>
                <span>
                  {state === 'POSE_READY'
                    ? 'POSE READY · COUNTDOWN NEXT'
                    : engine?.stability.trackingLost
                      ? 'TRACKING LOST · HOLD POSITION'
                      : 'CONFIRMING POSE'}
                </span>
              </div>
              {engine?.fallbackAvailable && state === 'ACTION_TRACKING' && (
                <div className="fallback-prompt">
                  <p>Having trouble detecting the pose?</p>
                  <button
                    className="secondary-button"
                    onClick={() => controllerRef.current?.continueWithTouchFallback()}
                  >
                    Continue →
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}

        {state === 'COUNTDOWN' && (
          <div className="countdown-panel">
            <p>HOLD YOUR SIGNAL</p>
            <strong key={countdown}>{countdown}</strong>
          </div>
        )}

        {isCreating && primary && secondary && (
          <div className="center-panel creating-panel">
            <SignalField active />
            <p className="step-label">05 · AI CREATE</p>
            <h2>Co-creating your<br />future portrait</h2>
            <p>{primary} × {secondary} × {mode}</p>
            <div className="progress-track"><i /></div>
          </div>
        )}

        {isResult && portrait && (
          <div className="result-layout">
            <div className="portrait-wrap">
              <img src={portrait.imageData} alt={`${portrait.primary} and ${portrait.secondary} future portrait`} />
              <span>FUTURE PORTRAIT · {portrait.id.slice(0, 6).toUpperCase()}</span>
            </div>
            <aside className="result-copy">
              <p className="step-label">06 · CO-CREATED</p>
              <h2>Your signal<br />joined the future.</h2>
              <div className="result-equation">
                <strong>{portrait.primary}</strong><span>×</span><strong>{portrait.secondary}</strong>
              </div>
              <p>{resultNarrative || portrait.narrative}</p>
              <div className="collective-confirmation">
                <i className="status-dot" />
                {state === 'COMPLETE'
                  ? 'Added to the collective signal'
                  : 'Connecting to the collective signal…'}
              </div>
              <div className="result-actions">
                <a className="primary-button" href={portrait.imageData} download={`bosch-future-${portrait.id}.jpg`}>
                  Save portrait <span>↓</span>
                </a>
                <button className="text-button" onClick={restart}>Create another</button>
              </div>
              <a className="wall-link" href="/wall">View collective experience →</a>
            </aside>
          </div>
        )}

        {state === 'ERROR' && (
          <div className="center-panel error-panel">
            <p className="step-label">RECOVERY</p>
            <h2>Let’s try that again.</h2>
            <p>{error || 'The interaction paused safely before capture.'}</p>
            <button className="primary-button" onClick={restart}>Restart experience →</button>
          </div>
        )}

        {debug && engine && (
          <PerceptionDebugOverlay snapshot={engine} cameraStatus={cameraStatus} />
        )}
      </section>
      <footer className="booth-footer">
        <span>HUMAN INTENTION</span><i /> <span>LOCAL AI PERCEPTION</span><i /> <span>CO-CREATED FUTURE</span>
      </footer>
    </main>
  );
}
