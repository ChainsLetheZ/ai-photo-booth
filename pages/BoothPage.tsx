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
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import { simpleMode } from '../config/simpleMode';
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
import { capturePoseTrace } from '../services/poseTrace';
import {
  publishPortrait,
  reserveWallCode,
} from '../services/portraitStore';
import type { BehaviorReading, PortraitRecord, PoseTrace } from '../types';

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
    case 'IDLE':
      return 'STEP INTO VIEW';
    case 'PERCEIVING':
      return (engine.simpleFlow?.heldMs ?? 0) < simpleMode.iSeeYouMs
        ? 'I SEE YOU'
        : 'READING YOUR POSE';
    case 'LOCKED':
      return 'LOCKED';
    case 'PASSERBY':
      return cameraStatus === 'ready' ? 'STEP INTO VIEW' : 'CAMERA NEEDS ATTENTION';
    case 'ENGAGED':
      return interactionConfig.zoneBypass.enabled
        ? 'HOLD YOUR POSITION'
        : `STEP FORWARD ABOUT ${interactionConfig.zones.approximateForwardStepMeters.toFixed(1)} M`;
    case 'CAPTURE_ZONE':
      return engine.zones.capturePeople.length
        ? 'HOLD YOUR POSITION'
        : interactionConfig.zoneBypass.enabled
          ? 'STAY IN VIEW'
          : 'STEP INTO THE CAPTURE AREA';
    case 'DIRECT':
      return engine.zones.activePeople.length > 1
        ? 'SOMEONE RAISE YOUR HAND OR WAVE'
        : 'RAISE YOUR HAND OR WAVE';
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
    case 'IDLE':
      return 'Move into view when you are ready.';
    case 'PERCEIVING':
      return 'wave if you’re ready';
    case 'LOCKED':
      return 'Your pose is ready.';
    case 'PASSERBY':
      return 'Move closer and the installation will respond.';
    case 'ENGAGED':
      return interactionConfig.zoneBypass.enabled
        ? 'Stay visible and the action prompt will begin.'
        : 'Cross the demo capture line to begin. Step back any time to cancel.';
    case 'CAPTURE_ZONE':
      return engine.zones.capturePeople.length
        ? `Confirming ${engine.zones.capturePeople.length} ${
            engine.zones.capturePeople.length === 1 ? 'person' : 'people'
          } in the capture area.`
        : 'No photo will be taken until you step forward.';
    case 'DIRECT':
      return 'One clear movement is enough for the whole group.';
    case 'POSE_READY':
      return 'AI vision understood the gesture.';
    case 'COUNTDOWN':
      return effectiveInteractionConfig.countdownSkipValidation
        ? 'Photo will be taken when the countdown reaches zero.'
        : interactionConfig.zoneBypass.enabled
          ? 'Leave the camera view before the shutter to cancel.'
          : 'Step back before the shutter to cancel.';
    case 'CAPTURE':
      return 'The intended photo has been captured.';
    case 'CREATE':
      return 'AI vision interpreted your movement; the portrait is assembled locally.';
    case 'RESULT':
      return 'Your portrait is on the collective wall. Save a copy if you want one.';
    case 'ERROR':
      return 'No photo was taken. Reset when ready.';
  }
}

export default function BoothPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [engine, setEngine] = useState<InteractionEngineSnapshot | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedPoseTrace, setCapturedPoseTrace] = useState<PoseTrace[]>([]);
  const [portrait, setPortrait] = useState<PortraitRecord | null>(null);
  const [resultNarrative, setResultNarrative] = useState('');
  const [gesturePromptIndex, setGesturePromptIndex] = useState(0);
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraService | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const generationStartedRef = useRef(false);
  const debug = useMemo(
    () => new URLSearchParams(window.location.search).get('debug') === 'true',
    [],
  );

  const state = engine?.state ?? (simpleMode.enabled ? 'IDLE' : 'PASSERBY');
  const primary = engine?.primary ?? 'Intelligence';
  const secondary = engine?.secondary ?? 'Precision';
  const mode = engine?.mode ?? 'Single';
  const defaultInstruction = mainInstruction(engine, cameraStatus);
  const instruction =
    !simpleMode.enabled &&
    state === 'DIRECT' &&
    interactionConfig.demoMode.enabled &&
    effectiveInteractionConfig.instructionCycleMs !== null
      ? ['RAISE YOUR HAND', 'OR JUST WAVE'][gesturePromptIndex % 2]
      : defaultInstruction;
  const detail =
    simpleMode.enabled && state === 'PERCEIVING'
      ? engine?.simpleFlow?.handRaised
        ? 'I see your hand'
        : ['wave if you’re ready', 'or give a thumbs up'][
            gesturePromptIndex % 2
          ]
      : instructionDetail(engine);
  const activeColor = ENERGY_CONFIG[primary].color;
  const raiseFeedbackProgress = Math.max(
    0,
    Math.min(
      1,
      ((engine?.gesture?.matchScore ?? 0) -
        interactionConfig.raiseArmStartScore) /
        Math.max(
          0.01,
          effectiveInteractionConfig.raiseArmScoreThreshold -
            interactionConfig.raiseArmStartScore,
        ),
    ),
  );
  const gestureFeedbackProgress = simpleMode.enabled
    ? engine?.simpleFlow?.ringProgress ?? 0
    : effectiveInteractionConfig.immediateGestureFeedback
      ? Math.max(
          engine?.stability.progress ?? 0,
          raiseFeedbackProgress,
          engine?.wave?.active ? Math.max(0.12, engine.wave.progress) : 0,
        )
      : engine?.stability.progress ?? 0;

  const goToWall = useCallback(() => {
    window.history.pushState(null, '', '/wall');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const restart = useCallback(() => {
    generationStartedRef.current = false;
    setCapturedImage(null);
    setCapturedPoseTrace([]);
    setPortrait(null);
    setResultNarrative('');
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
    if (simpleMode.enabled) {
      if (state !== 'PERCEIVING') {
        setGesturePromptIndex(0);
        return undefined;
      }
      setGesturePromptIndex(0);
      const timer = window.setInterval(
        () => setGesturePromptIndex((index) => (index + 1) % 2),
        simpleMode.subCopyRotateMs,
      );
      return () => window.clearInterval(timer);
    }
    if (
      state !== 'DIRECT' ||
      effectiveInteractionConfig.instructionCycleMs === null
    ) {
      setGesturePromptIndex(0);
      return undefined;
    }
    setGesturePromptIndex(0);
    const timer = window.setInterval(
      () => setGesturePromptIndex((index) => (index + 1) % 2),
      effectiveInteractionConfig.instructionCycleMs,
    );
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (!simpleMode.enabled || state !== 'IDLE') return;
    generationStartedRef.current = false;
    setCapturedImage(null);
    setCapturedPoseTrace([]);
    setPortrait(null);
    setResultNarrative('');
    setError('');
  }, [state]);

  useEffect(() => {
    if (
      !('speechSynthesis' in window) ||
      state === 'IDLE' ||
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
    const captureSnapshot = controllerRef.current?.getSnapshot();
    const captureVideo = videoRef.current;
    setCapturedPoseTrace(
      captureSnapshot?.frame && captureVideo
        ? capturePoseTrace(
            captureSnapshot.frame.people,
            captureVideo,
            captureSnapshot.initiatorId,
          )
        : [],
    );
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
      (simpleMode.enabled ? state !== 'CAPTURE' : state !== 'CREATE') ||
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
          capturedPoseTrace,
        );
        if (cancelled) return;
        const shortCode = await reserveWallCode(result.id);
        if (cancelled) return;
        const published = { ...result, shortCode };
        setResultNarrative(narrative.response);
        setPortrait(published);
        controllerRef.current?.generationComplete();
        // Taking the photo is the consent — every capture goes to the wall,
        // with no second confirmation and no way to hold one back.
        publishPortrait(published).catch((cause) => {
          console.error('Wall publish failed', cause);
        });
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
  }, [state, capturedImage, capturedPoseTrace, mode, primary, secondary]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restart();
      const target = event.target as HTMLElement | null;
      if (
        event.code === 'Space' &&
        (simpleMode.enabled
          ? simpleMode.allowManualShutter
          : effectiveInteractionConfig.manualShutterEnabled) &&
        target?.tagName !== 'INPUT' &&
        target?.tagName !== 'TEXTAREA'
      ) {
        event.preventDefault();
        controllerRef.current?.manualShutter();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [restart]);

  useEffect(() => {
    if (state !== 'RESULT' || simpleMode.enabled) return undefined;
    const timer = window.setTimeout(restart, 90_000);
    return () => window.clearTimeout(timer);
  }, [restart, state]);

  return (
    <main
      className="booth-v1"
      style={{ '--active': activeColor } as React.CSSProperties}
    >
      <section className="ai-mirror">
        <div className="kv-backdrop" aria-hidden="true" />
        <div className="kv-logo" aria-hidden="true">
          BOSCH
        </div>
        <div className="kv-headline" aria-hidden="true">
          <h2>竞速智联　共塑致远</h2>
          <p>Accelerate Innovation　Go Beyond Together</p>
        </div>

        <button
          type="button"
          className="booth-wall-preview"
          onClick={goToWall}
        >
          <span>OPEN COLLECTIVE WALL</span>
          <small>WALL PREVIEW</small>
          <b>→</b>
        </button>

        <div className="kv-portal">
          <video ref={videoRef} muted playsInline className="camera-feed" />
          {engine && (
            <PerceptionHaloLayer snapshot={engine} videoRef={videoRef} />
          )}
          <div className="mirror-grade" />
          <div className="mirror-noise" />

          <header className="mirror-header">
            <div className="mirror-brand">
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
              {!interactionConfig.zoneBypass.enabled && (
                <div className="capture-zone-guide" aria-hidden="true">
                  <span />
                  <b>
                    {`≈${interactionConfig.zones.approximateForwardStepMeters.toFixed(1)}M FORWARD · STEP BACK TO CANCEL`}
                  </b>
                  <span />
                </div>
              )}

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
                {!simpleMode.enabled && state === 'DIRECT' && (
                  <div
                    className={`gesture-progress ${
                      gestureFeedbackProgress > 0 ? 'is-detected' : ''
                    }`}
                  >
                    <i
                      style={{
                        width: `${Math.round(gestureFeedbackProgress * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {simpleMode.enabled &&
                  (state === 'PERCEIVING' || state === 'LOCKED') && (
                    <div
                      className={`simple-progress-ring ${
                        engine?.simpleFlow?.handRaised ? 'is-boosted' : ''
                      } ${state === 'LOCKED' ? 'is-locked' : ''}`}
                      style={{
                        '--simple-progress': `${Math.round(
                          gestureFeedbackProgress * 360,
                        )}deg`,
                      } as React.CSSProperties}
                      data-testid="simple-progress-ring"
                      aria-label={`${Math.round(gestureFeedbackProgress * 100)}% ready`}
                    >
                      <i />
                      <span>{Math.round(gestureFeedbackProgress * 100)}</span>
                    </div>
                  )}
              </div>
            </>
          )}

          <footer className="mirror-footer">
            <span>
              {interactionConfig.zoneBypass.enabled
                ? 'PERSON DETECTION STARTS THE PHOTO FLOW'
                : 'ENTERING THE CAPTURE AREA STARTS THE PHOTO FLOW'}
            </span>
            <span>LIVE VIDEO STAYS ON THIS DEVICE</span>
          </footer>
        </div>

        {(state === 'CREATE' ||
          (simpleMode.enabled && state === 'CAPTURE' && capturedImage)) && (
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
            <div className="v1-portrait-stack">
              <div className="v1-portrait">
                <img
                  src={portrait.imageData}
                  alt="AI-assisted future portrait"
                />
                {debug && portrait.poseTrace?.length ? (
                  <svg
                    className="pose-trace-validation"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    aria-label="Pose trace alignment validation"
                  >
                    {portrait.poseTrace.map((trace, traceIndex) => (
                      <g key={traceIndex}>
                        {trace.hullPoints.length >= 3 && (
                          <polygon
                            points={trace.hullPoints
                              .map((point) => `${point.x},${point.y}`)
                              .join(' ')}
                          />
                        )}
                        {trace.keypoints.map((point) => (
                          <circle
                            key={point.name}
                            cx={point.x}
                            cy={point.y}
                            r="0.006"
                          />
                        ))}
                      </g>
                    ))}
                  </svg>
                ) : null}
                <span>AI-ASSISTED · LOCAL POSE PERCEPTION</span>
              </div>
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
                <button className="v1-action subtle" onClick={restart}>
                  RETAKE
                </button>
              </div>
              <button
                type="button"
                className="v1-wall-link"
                onClick={goToWall}
              >
                VIEW COLLECTIVE WALL →
              </button>
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

        <div className="sr-only" aria-live="polite">
          {instruction}. {detail}
        </div>

        {debug && engine && (
          <PerceptionDebugOverlay
            snapshot={engine}
            cameraStatus={cameraStatus}
            videoRef={videoRef}
          />
        )}
      </section>
    </main>
  );
}
