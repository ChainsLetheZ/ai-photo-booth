import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BrowserCameraService,
  blobToDataUrl,
  type CameraStatus,
} from '../camera/CameraService';
import PerceptionHaloLayer from '../components/PerceptionHaloLayer';
import { interactionConfig } from '../config/interactionConfig';
import { ENERGY_CONFIG, EVENT } from '../constants';
import PerceptionDebugOverlay from '../debug/PerceptionDebugOverlay';
import {
  InteractionController,
  type InteractionEngineSnapshot,
} from '../interaction/InteractionController';
import { getFallbackNarrative } from '../narrative/narrativeFallbacks';
import {
  generateNarrative,
  type NarrativeMetadata,
} from '../narrative/NarrativeService';
import { renderFuturePortrait } from '../services/portraitRenderer';
import { publishPortrait } from '../services/portraitStore';
import type { BehaviorReading, PortraitRecord } from '../types';

function makeFallbackCapture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 960;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#153B55');
  gradient.addColorStop(1, '#50237F');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#FFFFFF';
  context.font = '600 34px Arial';
  context.textAlign = 'center';
  context.fillText('CAMERA PREVIEW', 640, 875);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function mainInstruction(
  engine: InteractionEngineSnapshot | null,
  cameraStatus: CameraStatus,
) {
  if (!engine) {
    return cameraStatus === 'starting'
      ? 'PREPARING LOCAL AI VISION'
      : 'STEP INTO VIEW';
  }
  if (cameraStatus === 'starting') return 'PREPARING LOCAL AI VISION';
  if (cameraStatus !== 'ready') return 'CAMERA NEEDS ATTENTION';
  if (
    engine.perception.status === 'loading' ||
    engine.perception.status === 'ready' ||
    !engine.frame
  ) {
    return 'WARMING UP LOCAL AI VISION';
  }
  if (engine.zones.overflow) return 'MAX 5 PEOPLE — PLEASE SPLIT INTO TWO GROUPS';
  switch (engine.state) {
    case 'PASSERBY':
      return cameraStatus === 'ready' ? 'STEP INTO VIEW' : 'CAMERA NEEDS ATTENTION';
    case 'ENGAGED':
      return `STEP FORWARD ABOUT ${interactionConfig.zones.approximateForwardStepMeters.toFixed(1)} M`;
    case 'CAPTURE_ZONE':
      return engine.zones.capturePeople.length
        ? 'HOLD YOUR POSITION'
        : 'STEP INTO THE CAPTURE AREA';
    case 'DIRECT':
      return engine.zones.activePeople.length > 1
        ? 'SOMEONE RAISE ONE ARM'
        : 'RAISE ONE ARM';
    case 'POSE_READY':
      return 'GOT IT — HOLD';
    case 'COUNTDOWN':
      return 'STAY IN FRAME';
    case 'CAPTURE':
      return 'CAPTURED';
    case 'CREATE':
      return 'CREATING YOUR FUTURE PORTRAIT';
    case 'RESULT':
      return 'YOUR FUTURE PORTRAIT';
    case 'ERROR':
      return 'THE EXPERIENCE PAUSED SAFELY';
  }
}

function instructionDetail(engine: InteractionEngineSnapshot | null) {
  if (!engine) return 'Live perception stays on this device.';
  if (
    engine.perception.status === 'loading' ||
    engine.perception.status === 'ready' ||
    !engine.frame
  ) {
    return 'The first local inference can take a few seconds; video is not uploaded.';
  }
  if (engine.zones.overflow) {
    return `${engine.zones.capturePeople.length} people are in the capture area.`;
  }
  switch (engine.state) {
    case 'PASSERBY':
      return 'Move closer and the installation will respond.';
    case 'ENGAGED':
      return 'Cross the demo capture line to begin. Step back any time to cancel.';
    case 'CAPTURE_ZONE':
      return engine.zones.capturePeople.length
        ? `Confirming ${engine.zones.capturePeople.length} ${
            engine.zones.capturePeople.length === 1 ? 'person' : 'people'
          } in the capture area.`
        : 'No photo will be taken until you step forward.';
    case 'DIRECT':
      return 'One clear movement is enough for the whole group.';
    case 'POSE_READY':
      return 'AI vision understood the raised arm.';
    case 'COUNTDOWN':
      return 'Step back before the shutter to cancel.';
    case 'CAPTURE':
      return 'The intended photo has been captured.';
    case 'CREATE':
      return 'AI vision interpreted your movement; the portrait is assembled locally.';
    case 'RESULT':
      return 'Saving and adding to the collective wall are separate choices.';
    case 'ERROR':
      return 'No photo was taken. Reset when ready.';
  }
}

export default function BoothPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [engine, setEngine] = useState<InteractionEngineSnapshot | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<PortraitRecord | null>(null);
  const [resultNarrative, setResultNarrative] = useState('');
  const [error, setError] = useState('');
  const [wallStatus, setWallStatus] = useState<
    'idle' | 'publishing' | 'published'
  >('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraService | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const generationStartedRef = useRef(false);
  const debug = useMemo(
    () => new URLSearchParams(window.location.search).get('debug') === 'true',
    [],
  );

  const state = engine?.state ?? 'PASSERBY';
  const primary = engine?.primary ?? 'Intelligence';
  const secondary = engine?.secondary ?? 'Precision';
  const mode = engine?.mode ?? 'Single';
  const instruction = mainInstruction(engine, cameraStatus);
  const detail = instructionDetail(engine);
  const activeColor = ENERGY_CONFIG[primary].color;

  const restart = useCallback(() => {
    generationStartedRef.current = false;
    setCapturedImage(null);
    setPortrait(null);
    setResultNarrative('');
    setWallStatus('idle');
    setError('');
    controllerRef.current?.reset();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const camera = new BrowserCameraService(video);
    const controller = new InteractionController(video, setEngine, {
      enableBodyScaleProbe: debug,
    });
    cameraRef.current = camera;
    controllerRef.current = controller;
    setEngine(controller.getSnapshot());

    let cancelled = false;
    camera
      .start()
      .then(async () => {
        if (cancelled) return;
        setCameraStatus(camera.getStatus());
        try {
          await controller.start();
        } catch (cause) {
          if (cancelled) return;
          setError(
            cause instanceof Error
              ? cause.message
              : 'Local AI vision could not start.',
          );
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setCameraStatus(camera.getStatus());
        setError(
          cause instanceof Error ? cause.message : 'Camera could not start.',
        );
      });

    return () => {
      cancelled = true;
      controller.close();
      camera.stop();
    };
  }, [debug]);

  useEffect(() => {
    if (
      !('speechSynthesis' in window) ||
      state === 'PASSERBY' ||
      state === 'CAPTURE' ||
      state === 'CREATE' ||
      state === 'RESULT'
    ) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      instruction.replace('—', '.'),
    );
    utterance.rate = 0.94;
    utterance.volume = 0.78;
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [instruction, state]);

  useEffect(() => {
    if (state !== 'CAPTURE') return;
    let cancelled = false;
    const capture = async () => {
      try {
        const camera = cameraRef.current;
        const dataUrl =
          camera?.getStatus() === 'ready'
            ? await blobToDataUrl(await camera.captureFrame())
            : makeFallbackCapture();
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
  }, [state]);

  useEffect(() => {
    if (
      state !== 'CREATE' ||
      !capturedImage ||
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
            handsConverged: false,
            armsOpen: generationEngine.features.armsOpen,
          },
        };
        const narrative = await generateNarrative(metadata).catch(() =>
          getFallbackNarrative(primary, secondary),
        );
        const reading: BehaviorReading = {
          peopleCount: metadata.groupSize,
          mode,
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
          cause instanceof Error
            ? cause.message
            : 'Unable to create the portrait.',
        );
        controllerRef.current?.fail();
      }
    };
    generate();
    return () => {
      cancelled = true;
    };
  }, [state, capturedImage, mode, primary, secondary]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restart();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [restart]);

  useEffect(() => {
    if (state !== 'RESULT') return undefined;
    const timer = window.setTimeout(restart, 90_000);
    return () => window.clearTimeout(timer);
  }, [restart, state]);

  const addToWall = async () => {
    if (!portrait || wallStatus !== 'idle') return;
    setWallStatus('publishing');
    await publishPortrait(portrait);
    setWallStatus('published');
  };

  return (
    <main
      className="booth-v1"
      style={{ '--active': activeColor } as React.CSSProperties}
    >
      <section className="ai-mirror">
        <video ref={videoRef} muted playsInline className="camera-feed" />
        {engine && (
          <PerceptionHaloLayer snapshot={engine} videoRef={videoRef} />
        )}
        <div className="mirror-grade" />
        <div className="mirror-noise" />

        <header className="mirror-header">
          <div className="mirror-brand">
            <strong>BOSCH</strong>
            <span>{EVENT.title}</span>
          </div>
          <div className="ai-presence">
            <i />
            LOCAL AI PERCEPTION
            <span>ON DEVICE</span>
          </div>
        </header>

        {state !== 'RESULT' && (
          <>
            <div className="capture-zone-guide" aria-hidden="true">
              <span />
              <b>
                {`≈${interactionConfig.zones.approximateForwardStepMeters.toFixed(1)}M FORWARD · STEP BACK TO CANCEL`}
              </b>
              <span />
            </div>

            <div className={`mirror-instruction state-${state.toLowerCase()}`}>
              <p>
                {engine && !engine.frame
                  ? 'LOCAL MODEL INITIALIZING'
                  : engine?.zones.capturePeople.length
                  ? `${engine.zones.capturePeople.length}/5 IN CAPTURE AREA`
                  : engine?.zones.engagedPeople.length
                    ? `${engine.zones.engagedPeople.length} ${
                        engine.zones.engagedPeople.length === 1
                          ? 'PERSON'
                          : 'PEOPLE'
                      } DETECTED`
                    : 'AI MIRROR READY'}
              </p>
              {state === 'COUNTDOWN' ? (
                <strong className="mirror-countdown" key={engine?.countdown}>
                  {engine?.countdown ?? 3}
                </strong>
              ) : (
                <h1>{instruction}</h1>
              )}
              <small>{detail}</small>
              {state === 'DIRECT' && (
                <div className="gesture-progress">
                  <i
                    style={{
                      width: `${Math.round(
                        (engine?.stability.progress ?? 0) * 100,
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {state === 'CREATE' && (
          <div className="create-trace">
            <span>AI VISION READ</span>
            <i />
            <span>MOVEMENT INTERPRETED</span>
            <i />
            <span>PORTRAIT ASSEMBLING</span>
          </div>
        )}

        {state === 'RESULT' && portrait && (
          <div className="v1-result">
            <div className="v1-portrait">
              <img
                src={portrait.imageData}
                alt="AI-assisted future portrait"
              />
              <span>AI-ASSISTED · LOCAL POSE PERCEPTION</span>
            </div>
            <div className="v1-result-copy">
              <p>YOUR FUTURE PORTRAIT</p>
              <h1>Movement became a visual signal.</h1>
              <div className="result-attribution">
                Local AI vision interpreted the group’s movement. The portrait
                was assembled from the intended photo and a deterministic
                visual system.
              </div>
              <p className="result-narrative">
                {resultNarrative || portrait.narrative}
              </p>
              <div className="v1-result-actions">
                <a
                  className="v1-action primary"
                  href={portrait.imageData}
                  download={`bosch-future-${portrait.id}.jpg`}
                >
                  SAVE PORTRAIT
                </a>
                <button
                  className="v1-action"
                  onClick={addToWall}
                  disabled={wallStatus !== 'idle'}
                >
                  {wallStatus === 'published'
                    ? 'ADDED TO WALL'
                    : wallStatus === 'publishing'
                      ? 'ADDING…'
                      : 'ADD TO WALL'}
                </button>
                <button className="v1-action subtle" onClick={restart}>
                  RETAKE
                </button>
              </div>
              <a className="v1-wall-link" href="/wall">
                VIEW COLLECTIVE WALL →
              </a>
            </div>
          </div>
        )}

        {(engine?.perception.warning || error) && state !== 'RESULT' && (
          <div className="demo-warning">
            <strong>
              {error ? 'RECOVERY' : 'DEMO FALLBACK'}
            </strong>
            <span>{error || engine?.perception.warning}</span>
            {error && (
              <button type="button" onClick={restart}>
                RESET
              </button>
            )}
          </div>
        )}

        <footer className="mirror-footer">
          <span>ENTERING THE CAPTURE AREA STARTS THE PHOTO FLOW</span>
          <span>LIVE VIDEO STAYS ON THIS DEVICE</span>
        </footer>

        <div className="sr-only" aria-live="polite">
          {instruction}. {detail}
        </div>

        {debug && engine && (
          <PerceptionDebugOverlay
            snapshot={engine}
            cameraStatus={cameraStatus}
          />
        )}
      </section>
    </main>
  );
}
