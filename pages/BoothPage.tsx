import React, { useCallback, useEffect, useRef, useState } from 'react';
import BrandBar from '../components/BrandBar';
import SignalField from '../components/SignalField';
import {
  DIRECTION_COPY,
  ENERGY_CONFIG,
  EVENT,
  SECONDARY_COPY,
} from '../constants';
import { publishPortrait } from '../services/portraitStore';
import { renderFuturePortrait } from '../services/portraitRenderer';
import type {
  BehaviorReading,
  BoothPhase,
  GroupMode,
  PortraitRecord,
  PrimaryEnergy,
  SecondaryDimension,
} from '../types';

type CameraState = 'starting' | 'ready' | 'blocked' | 'unavailable';

const ENERGY_ORDER = Object.keys(ENERGY_CONFIG) as PrimaryEnergy[];

function modeFromCount(count: number): GroupMode {
  if (count >= 3) return 'Group';
  if (count === 2) return 'Pair';
  return 'Single';
}

function chooseSecondary(
  count: number,
  movement: number,
  cohesion: number,
): SecondaryDimension {
  if (count > 1 && cohesion > 0.52) return 'Collaboration';
  if (movement > 0.12) return 'Momentum';
  if (movement < 0.045) return 'Precision';
  return 'Exploration';
}

function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.8 5.5 9.1 3.8h5.8l1.3 1.7H20a2 2 0 0 1 2 2v10.7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h3.8Z" />
      <circle cx="12" cy="12.7" r="4.2" />
    </svg>
  );
}

export default function BoothPage() {
  const [phase, setPhase] = useState<BoothPhase>('idle');
  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [primary, setPrimary] = useState<PrimaryEnergy | null>(null);
  const [reading, setReading] = useState<BehaviorReading | null>(null);
  const [portrait, setPortrait] = useState<PortraitRecord | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [readyProgress, setReadyProgress] = useState(0);
  const [faces, setFaces] = useState(1);
  const [motion, setMotion] = useState(0);
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const motionSamplesRef = useRef<number[]>([]);
  const detectedFacesRef = useRef(1);
  const directionStartedRef = useRef(0);
  const motionSeenRef = useRef(false);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1440 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('ready');
    } catch {
      setCameraState('blocked');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [startCamera]);

  useEffect(() => {
    if (cameraState !== 'ready') return undefined;
    const canvas = sampleCanvasRef.current;
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const previous = previousFrameRef.current;
      let delta = 0;
      if (previous) {
        for (let index = 0; index < frame.length; index += 16) {
          delta += Math.abs(frame[index] - previous[index]);
          delta += Math.abs(frame[index + 1] - previous[index + 1]);
          delta += Math.abs(frame[index + 2] - previous[index + 2]);
        }
        delta /= (frame.length / 16) * 3 * 255;
      }
      previousFrameRef.current = new Uint8ClampedArray(frame);
      setMotion(delta);
      motionSamplesRef.current = [...motionSamplesRef.current.slice(-24), delta];

      if (phase === 'direction') {
        if (delta > 0.055) motionSeenRef.current = true;
        const elapsed = Date.now() - directionStartedRef.current;
        const stableAfterMovement = motionSeenRef.current && delta < 0.04;
        const progress = stableAfterMovement
          ? Math.min(100, readyProgress + 22)
          : Math.min(86, (elapsed / 5000) * 86);
        setReadyProgress(progress);
      }
    }, 180);

    return () => window.clearInterval(interval);
  }, [cameraState, phase, readyProgress]);

  useEffect(() => {
    if (cameraState !== 'ready' || (phase !== 'reading' && phase !== 'idle')) return undefined;
    const Detector = (window as typeof window & {
      FaceDetector?: new (options: { fastMode: boolean; maxDetectedFaces: number }) => {
        detect: (source: HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
      };
    }).FaceDetector;
    if (!Detector) return undefined;
    const detector = new Detector({ fastMode: true, maxDetectedFaces: 12 });
    const interval = window.setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      try {
        const results = await detector.detect(videoRef.current);
        const count = Math.max(1, results.length);
        detectedFacesRef.current = count;
        setFaces(count);
      } catch {
        // Keep the last stable count.
      }
    }, 700);
    return () => window.clearInterval(interval);
  }, [cameraState, phase]);

  useEffect(() => {
    if (phase !== 'reading' || !primary) return undefined;
    motionSamplesRef.current = [];
    const timer = window.setTimeout(() => {
      const samples = motionSamplesRef.current;
      const movement =
        samples.length > 0 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0.04;
      const peopleCount = detectedFacesRef.current;
      const cohesion = peopleCount > 1 ? Math.max(0.56, 0.82 - movement) : 0.44;
      const result: BehaviorReading = {
        peopleCount,
        mode: modeFromCount(peopleCount),
        movement,
        stability: Math.max(0, 1 - movement * 5),
        cohesion,
        secondary: chooseSecondary(peopleCount, movement, cohesion),
      };
      setReading(result);
      setPhase('response');
    }, 1900);
    return () => window.clearTimeout(timer);
  }, [phase, primary]);

  useEffect(() => {
    if (phase !== 'response') return undefined;
    const timer = window.setTimeout(() => {
      directionStartedRef.current = Date.now();
      motionSeenRef.current = false;
      setReadyProgress(0);
      setPhase('direction');
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'direction' && readyProgress >= 100) {
      const timer = window.setTimeout(() => beginCountdown(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase, readyProgress]);

  const selectEnergy = (energy: PrimaryEnergy) => {
    setPrimary(energy);
    setReading(null);
    setPhase('reading');
  };

  const captureFrame = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 960;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    const video = videoRef.current;
    if (cameraState === 'ready' && video && video.readyState >= 2) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
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
    }
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const createPortrait = async () => {
    if (!primary || !reading) return;
    setPhase('creating');
    try {
      const record = await renderFuturePortrait(captureFrame(), primary, reading);
      setPortrait(record);
      await publishPortrait(record);
      setPhase('result');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the portrait');
      setPhase('direction');
    }
  };

  const beginCountdown = () => {
    if (phase !== 'direction') return;
    setCountdown(3);
    setPhase('countdown');
    let value = 3;
    const timer = window.setInterval(() => {
      value -= 1;
      if (value === 0) {
        window.clearInterval(timer);
        createPortrait();
      } else {
        setCountdown(value);
      }
    }, 1000);
  };

  const restart = () => {
    setPrimary(null);
    setReading(null);
    setPortrait(null);
    setError('');
    setReadyProgress(0);
    setPhase('idle');
  };

  const activeColor = primary ? ENERGY_CONFIG[primary].color : '#00629A';
  const direction = reading ? DIRECTION_COPY[reading.mode] : DIRECTION_COPY.Single;

  return (
    <main className="booth-shell" style={{ '--active': activeColor } as React.CSSProperties}>
      <BrandBar />
      <section className="camera-stage">
        <video ref={videoRef} muted playsInline className="camera-feed" />
        <div className="camera-vignette" />
        <div className="camera-grid" />
        {phase !== 'idle' && phase !== 'result' && (
          <div className="live-readout">
            <span className="status-dot" />
            AI VISION ACTIVE
            <i />
            {faces} {faces === 1 ? 'PERSON' : 'PEOPLE'}
          </div>
        )}

        {phase === 'idle' && (
          <div className="idle-panel">
            <div className="presence-pill">
              <span className={cameraState === 'ready' ? 'status-dot' : 'status-dot muted'} />
              {cameraState === 'ready'
                ? faces > 1
                  ? 'I see a team forming.'
                  : 'A new signal is in view.'
                : cameraState === 'starting'
                  ? 'Preparing AI vision…'
                  : 'Camera preview is unavailable · Demo mode ready'}
            </div>
            <p className="kicker">{EVENT.eyebrow}</p>
            <h1>
              Bring your intention.
              <br />
              <em>Meet your future.</em>
            </h1>
            <p className="intro">
              Make one choice. AI will read how you move together, direct your pose,
              and co-create a future portrait.
            </p>
            <button className="primary-button" onClick={() => setPhase('select')}>
              Begin experience <span>→</span>
            </button>
            <p className="privacy-note">Camera frames are used only for this experience.</p>
          </div>
        )}

        {phase === 'select' && (
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
                    onClick={() => selectEnergy(energy)}
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

        {phase === 'reading' && (
          <div className="center-panel reading-panel">
            <SignalField active />
            <p className="step-label">02 · AI READ</p>
            <h2>Reading your<br />shared signal</h2>
            <p>Observing group rhythm · movement · alignment</p>
            <div className="read-bars">
              <span><i style={{ width: `${Math.min(100, 42 + motion * 420)}%` }} /></span>
              <span><i style={{ width: '74%' }} /></span>
              <span><i style={{ width: faces > 1 ? '86%' : '56%' }} /></span>
            </div>
          </div>
        )}

        {phase === 'response' && primary && reading && (
          <div className="center-panel response-panel">
            <p className="step-label">03 · AI RESPONSE</p>
            <div className="detected-lockup">
              <span>{primary.toUpperCase()}</span>
              <b>×</b>
              <span>{reading.secondary.toUpperCase()}</span>
            </div>
            <h2>Signal detected.</h2>
            <p>{SECONDARY_COPY[reading.secondary]}</p>
            <div className="activation-line"><i /> Activating your future scenario…</div>
          </div>
        )}

        {phase === 'direction' && reading && (
          <div className="direction-layout">
            <div className="pose-frame">
              <span className="corner top-left" />
              <span className="corner top-right" />
              <span className="corner bottom-left" />
              <span className="corner bottom-right" />
              <SignalField active />
            </div>
            <aside className="director-card">
              <p className="step-label">04 · AI DIRECTOR · {reading.mode.toUpperCase()}</p>
              <h2>{direction.headline}</h2>
              <p className="direction-copy">{direction.instruction}</p>
              <small>{direction.support}</small>
              <div className="ready-meter">
                <div><i style={{ width: `${readyProgress}%` }} /></div>
                <span>{readyProgress >= 100 ? 'POSE READY' : 'READING MOVEMENT'}</span>
              </div>
              <button className="secondary-button" onClick={beginCountdown}>
                I’m ready · touch fallback
              </button>
              {error && <p className="error-copy">{error}</p>}
            </aside>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="countdown-panel">
            <p>HOLD YOUR SIGNAL</p>
            <strong key={countdown}>{countdown}</strong>
          </div>
        )}

        {phase === 'creating' && primary && reading && (
          <div className="center-panel creating-panel">
            <SignalField active />
            <p className="step-label">05 · AI CREATE</p>
            <h2>Co-creating your<br />future portrait</h2>
            <p>{primary} × {reading.secondary} × {reading.mode}</p>
            <div className="progress-track"><i /></div>
          </div>
        )}

        {phase === 'result' && portrait && (
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
              <p>{portrait.narrative}</p>
              <div className="collective-confirmation">
                <i className="status-dot" />
                Added to the collective signal
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
      </section>
      <footer className="booth-footer">
        <span>HUMAN INTENTION</span><i /> <span>AI OBSERVATION</span><i /> <span>CO-CREATED FUTURE</span>
      </footer>
    </main>
  );
}
