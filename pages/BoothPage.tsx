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
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import {
  simpleMode,
  type SimpleGestureTarget,
} from '../config/simpleMode';
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

interface GestureTask {
  id: SimpleGestureTarget;
  icon: string;
  name: string;
  lines: [string, string];
}

const GESTURE_TASKS: GestureTask[] = [
  {
    id: 'wave',
    icon: '👋',
    name: '挥挥手',
    lines: ['一起挥挥手，', '跟未来打个招呼！'],
  },
  {
    id: 'victory',
    icon: '✌',
    name: '比个耶',
    lines: ['未来姿势加载中——', '一起比个耶！'],
  },
  {
    id: 'thumbs-up',
    icon: '👍',
    name: '点个赞',
    lines: ['给未来一个赞！', '一起竖起大拇指！'],
  },
];

function pickGestureTask(previous?: SimpleGestureTarget) {
  const choices = previous
    ? GESTURE_TASKS.filter((task) => task.id !== previous)
    : GESTURE_TASKS;
  return choices[Math.floor(Math.random() * choices.length)];
}

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

export default function BoothPage() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [engine, setEngine] = useState<InteractionEngineSnapshot | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedPoseTrace, setCapturedPoseTrace] = useState<PoseTrace[]>([]);
  const [portrait, setPortrait] = useState<PortraitRecord | null>(null);
  const [gestureTask, setGestureTask] = useState<GestureTask>(() =>
    pickGestureTask(),
  );
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraService | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const generationStartedRef = useRef(false);
  const previousStateRef = useRef<string>('IDLE');
  const debug = useMemo(
    () => new URLSearchParams(window.location.search).get('debug') === 'true',
    [],
  );

  const state = engine?.state ?? (simpleMode.enabled ? 'IDLE' : 'PASSERBY');
  const primary = engine?.primary ?? 'Intelligence';
  const secondary = engine?.secondary ?? 'Precision';
  const mode = engine?.mode ?? 'Single';
  const activeColor = ENERGY_CONFIG[primary].color;
  const phaseHeldMs = engine?.simpleFlow?.heldMs ?? 0;

  const restart = useCallback(() => {
    generationStartedRef.current = false;
    setCapturedImage(null);
    setCapturedPoseTrace([]);
    setPortrait(null);
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
    controller.setSimpleGestureTarget(gestureTask.id);
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
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (state !== 'IDLE' || previous === 'IDLE') return;
    const nextTask = pickGestureTask(gestureTask.id);
    setGestureTask(nextTask);
    controllerRef.current?.setSimpleGestureTarget(nextTask.id);
  }, [gestureTask.id, state]);

  useEffect(() => {
    if (!simpleMode.enabled || state !== 'IDLE') return;
    generationStartedRef.current = false;
    setCapturedImage(null);
    setCapturedPoseTrace([]);
    setPortrait(null);
    setError('');
  }, [state]);

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
        setPortrait(published);
        // Taking the photo is the consent — every capture goes to the wall,
        // with no second confirmation and no way to hold one back.
        publishPortrait(published).catch((cause) => {
          console.error('Wall publish failed', cause);
        });
        await new Promise((resolve) =>
          window.setTimeout(resolve, simpleMode.photoPreviewMs),
        );
        if (cancelled) return;
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

  const visiblePeopleCount = engine?.zones.visiblePeople.length ?? 0;
  const capturePeopleCount = engine?.zones.capturePeople.length ?? 0;
  const tooManyPeople =
    visiblePeopleCount > interactionConfig.perception.maxActiveParticipants;
  const needsCloser =
    !tooManyPeople &&
    visiblePeopleCount > capturePeopleCount;
  const positionGuidanceNeeded = tooManyPeople || needsCloser;
  const taskStartsAt =
    simpleMode.iSeeYouMs +
    (positionGuidanceNeeded ? simpleMode.positionGuidanceMs : 0);
  const introActive =
    state === 'PERCEIVING' && phaseHeldMs < simpleMode.iSeeYouMs;
  const guidanceActive =
    state === 'PERCEIVING' &&
    positionGuidanceNeeded &&
    phaseHeldMs >= simpleMode.iSeeYouMs &&
    phaseHeldMs < taskStartsAt;
  const taskPhaseMs = Math.max(0, phaseHeldMs - taskStartsAt);
  const lockedConfirming = state === 'LOCKED' && phaseHeldMs < 750;
  const rightExiting =
    state === 'LOCKED' && phaseHeldMs >= 750 && phaseHeldMs < 1350;
  const showRightBlink =
    (state === 'PERCEIVING' && phaseHeldMs >= taskStartsAt) ||
    lockedConfirming ||
    rightExiting;
  const leftVideoKey =
    state === 'IDLE'
      ? 'left-idle'
      : state === 'PERCEIVING'
        ? phaseHeldMs < taskStartsAt
          ? 'left-notice'
          : 'left-camera-up'
        : state === 'CAPTURE' || state === 'CREATE'
          ? capturedImage
            ? 'left-photo-out'
            : 'left-flash'
          : state === 'RESULT'
            ? 'left-photo-out'
            : 'left-hold';
  const rightVideoKey = rightExiting
    ? 'right-exit'
    : state === 'PERCEIVING'
      ? taskPhaseMs < simpleMode.iSeeYouMs
        ? 'right-enter'
        : 'right-gesture'
      : 'right-success';
  const photoImage = portrait?.imageData ?? null;

  let speaker: 'left' | 'right' | null = null;
  let dialogueLines: [string, string?] | null = null;
  if (state === 'IDLE') {
    speaker = 'left';
    dialogueLines = ['来，站进取景框里！', '我来帮你们拍一张。'];
  } else if (state === 'PERCEIVING') {
    if (introActive) {
      speaker = 'left';
      dialogueLines = ['看到啦！', '准备好了吗？'];
    } else if (guidanceActive) {
      speaker = 'left';
      dialogueLines = tooManyPeople
        ? ['人数有点多，', '我们分两组拍吧！']
        : capturePeopleCount > 0
          ? ['大家靠近一些，', '别掉出取景框。']
          : ['再靠近一点，', '站进取景框就好！'];
    } else {
      speaker = 'right';
      dialogueLines =
        taskPhaseMs < simpleMode.iSeeYouMs
          ? ['接头暗号来了！', '一起比出这个手势吧！']
          : gestureTask.lines;
    }
  } else if (state === 'LOCKED') {
    if (lockedConfirming) {
      speaker = 'right';
      dialogueLines = ['暗号正确！'];
    } else {
      speaker = 'left';
      dialogueLines = ['很好，就这样！', '保持住——'];
    }
  } else if (state === 'RESULT') {
    speaker = 'left';
    dialogueLines = ['咔嚓！未来照片已发送！', '去现场大屏里找找自己吧！'];
  }

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

        <div className="kv-portal">
          <video ref={videoRef} muted playsInline className="camera-feed" />
          <div className="mirror-grade" />
          <div className="mirror-noise" />

          <header className="mirror-header">
            <div className="mirror-brand">
              <span>{EVENT.title}</span>
            </div>
          </header>

          <div
            className={`blink-viewfinder ${state === 'RESULT' ? 'is-complete' : ''}`}
            aria-hidden="true"
          >
            <i className="corner top-left" />
            <i className="corner top-right" />
            <i className="corner bottom-left" />
            <i className="corner bottom-right" />
          </div>

          <div className={`blink-slot blink-left state-${state.toLowerCase()}`}>
            <span>左侧 Blink 视频占位</span>
            <strong>{leftVideoKey}</strong>
          </div>

          <div className={`blink-slot blink-right ${showRightBlink ? 'is-visible' : ''}`}>
            <span>右侧 Blink 视频占位</span>
            <strong>{rightVideoKey}</strong>
          </div>

          {speaker && dialogueLines && state !== 'COUNTDOWN' && (
            <div
              className={`blink-dialogue speaker-${speaker} state-${state.toLowerCase()}`}
              key={`${state}-${speaker}`}
            >
              {dialogueLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {((state === 'PERCEIVING' && phaseHeldMs >= taskStartsAt) ||
                lockedConfirming) && (
                <div className={`gesture-task ${lockedConfirming ? 'is-success' : ''}`}>
                  <span aria-hidden="true">{lockedConfirming ? '✓' : gestureTask.icon}</span>
                  <strong>{lockedConfirming ? '识别成功' : gestureTask.name}</strong>
                </div>
              )}
            </div>
          )}

          {state === 'COUNTDOWN' && (
            <strong className="blink-countdown" key={engine?.countdown}>
              {engine?.countdown ?? 3}
            </strong>
          )}

          {(state === 'CAPTURE' || state === 'CREATE') && !capturedImage && (
            <div className="camera-flash" aria-hidden="true" />
          )}

          {photoImage && (state === 'CAPTURE' || state === 'CREATE' || state === 'RESULT') && (
            <div className={`photo-paper ${state === 'RESULT' ? 'is-flying' : 'is-developing'}`}>
              <img src={photoImage} alt="刚刚拍摄的照片" />
            </div>
          )}

          {state === 'RESULT' && (
            <div className="photo-wall-target" aria-hidden="true">
              <span>现场大屏</span>
              <i />
            </div>
          )}
        </div>

        {(engine?.perception.warning || error) && state !== 'RESULT' && (
          <div className="booth-error">
            <span>{error || engine?.perception.warning}</span>
            {error && (
              <button type="button" onClick={restart}>
                重试
              </button>
            )}
          </div>
        )}

        <div className="sr-only" aria-live="polite">
          {state === 'COUNTDOWN'
            ? engine?.countdown ?? 3
            : dialogueLines?.join(' ')}
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
