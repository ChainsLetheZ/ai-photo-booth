import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import QRCode from 'qrcode';
import {
  BrowserCameraService,
  blobToDataUrl,
  type CameraStatus,
} from '../camera/CameraService';
import {
  effectiveInteractionConfig,
  interactionConfig,
} from '../config/interactionConfig';
import { simpleMode } from '../config/simpleMode';
import { ENERGY_CONFIG, EVENT } from '../constants';
import PerceptionDebugOverlay from '../debug/PerceptionDebugOverlay';
import TransparentCharacterVideo from '../components/TransparentCharacterVideo';
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
  publicPhotoUrl,
  reserveWallCode,
} from '../services/portraitStore';
import type { BehaviorReading, PortraitRecord, PoseTrace } from '../types';

interface GestureTask {
  icon: string;
  name: string;
  lines: [string, string];
}

type UploadStage = 'generating' | 'reserving' | 'uploading' | 'qr';

const UPLOAD_STAGE_COPY: Record<UploadStage, string> = {
  generating: '正在生成你的未来照片…',
  reserving: '正在分配照片编号…',
  uploading: '正在上传照片到云端…',
  qr: '正在生成下载二维码…',
};

const GESTURE_TASK: GestureTask = {
  icon: '✋',
  name: '任选一个手势',
  lines: ['轮到你啦！挥挥手、举手，', '或者比个耶、点个赞都可以。'],
};

const assetBase = import.meta.env?.BASE_URL ?? '/';
const BOOTH_VIDEO = {
  idle: `${assetBase}videos/01-idle-loop.mp4`,
  arrival: `${assetBase}videos/02-arrival-once.mp4`,
  gesture: `${assetBase}videos/03-gesture-loop.mp4`,
  captureHold: `${assetBase}videos/04-capture-hold.mp4`,
} as const;

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
  const [claimQr, setClaimQr] = useState('');
  const [error, setError] = useState('');
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BrowserCameraService | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const generationStartedRef = useRef(false);
  const capturedPoseTraceRef = useRef<PoseTrace[]>([]);
  const captureEngineRef = useRef<InteractionEngineSnapshot | null>(null);
  const uploadStartedAtRef = useRef(0);
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
    capturedPoseTraceRef.current = [];
    setPortrait(null);
    setClaimQr('');
    setUploadStage(null);
    setUploadElapsedSeconds(0);
    setError('');
    captureEngineRef.current = null;
    controllerRef.current?.reset();
  }, []);

  useEffect(() => {
    if (!uploadStage) return undefined;
    const timer = window.setInterval(() => {
      setUploadElapsedSeconds(
        Math.floor((performance.now() - uploadStartedAtRef.current) / 1000),
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [uploadStage]);

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
    if (!simpleMode.enabled || state !== 'IDLE') return;
    generationStartedRef.current = false;
    setCapturedImage(null);
    setCapturedPoseTrace([]);
    setPortrait(null);
    setClaimQr('');
    if (!error) setError('');
  }, [error, state]);

  useEffect(() => {
    if (state !== 'CAPTURE') return;
    let cancelled = false;
    const captureSnapshot = controllerRef.current?.getSnapshot();
    captureEngineRef.current = captureSnapshot ?? null;
    const captureVideo = videoRef.current;
    const poseTrace = captureSnapshot?.frame && captureVideo
        ? capturePoseTrace(
            captureSnapshot.frame.people,
            captureVideo,
            captureSnapshot.initiatorId,
          )
        : [];
    capturedPoseTraceRef.current = poseTrace;
    setCapturedPoseTrace(poseTrace);
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
    const generationEngine = captureEngineRef.current;
    if (!generationEngine) return;
    generationStartedRef.current = true;
    let cancelled = false;

    const generate = async () => {
      const startedAt = performance.now();
      const timings: Record<string, number> = {};
      const mark = (name: string, since: number) => {
        timings[name] = Math.round(performance.now() - since);
      };
      uploadStartedAtRef.current = startedAt;
      setUploadElapsedSeconds(0);
      try {
        setUploadStage('generating');
        const capturedPrimary = generationEngine.primary ?? 'Intelligence';
        const capturedSecondary = generationEngine.secondary ?? 'Precision';
        const capturedMode = generationEngine.mode ?? 'Single';
        const metadata: NarrativeMetadata = {
          primaryEnergy: capturedPrimary,
          secondaryDimension: capturedSecondary,
          groupSize: Math.max(1, generationEngine.features.personCount),
          groupMode: capturedMode,
          behavior: {
            groupCohesion: generationEngine.features.groupCohesion,
            movementIntensity: generationEngine.features.movementIntensity,
            movementSynchrony: generationEngine.features.movementSynchrony,
            handsConverged: false,
            armsOpen: generationEngine.features.armsOpen,
          },
        };
        const portraitId = crypto.randomUUID();
        // Reserving a wall number is an independent network operation. Start it
        // while narrative/rendering run instead of adding another round trip.
        const reserveStartedAt = performance.now();
        const shortCodePromise = reserveWallCode(portraitId).then((code) => {
          mark('reserve', reserveStartedAt);
          return code;
        });
        const narrativeStartedAt = performance.now();
        const narrative = await generateNarrative(metadata).catch(() =>
          getFallbackNarrative(capturedPrimary, capturedSecondary),
        );
        mark('narrative', narrativeStartedAt);
        const reading: BehaviorReading = {
          peopleCount: metadata.groupSize,
          mode: capturedMode,
          movement: generationEngine.features.movementIntensity,
          stability: generationEngine.features.stability,
          cohesion: generationEngine.features.groupCohesion,
          secondary: capturedSecondary,
        };
        const renderStartedAt = performance.now();
        const result = await renderFuturePortrait(
          capturedImage,
          capturedPrimary,
          reading,
          narrative.response,
          capturedPoseTraceRef.current,
          portraitId,
        );
        mark('render', renderStartedAt);
        if (cancelled) return;
        setUploadStage('reserving');
        const shortCode = await shortCodePromise;
        if (cancelled) return;
        const published = { ...result, shortCode };
        setPortrait(published);
        // Taking the photo is the consent — every capture goes to the wall,
        // with no second confirmation and no way to hold one back.
        setUploadStage('uploading');
        const publishStartedAt = performance.now();
        const wallEntry = await publishPortrait(published);
        mark('publish', publishStartedAt);
        if (cancelled) return;
        setUploadStage('qr');
        const qrStartedAt = performance.now();
        const claimUrl = publicPhotoUrl(wallEntry.claimToken);
        setClaimQr(
          await QRCode.toDataURL(claimUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
          }),
        );
        mark('qr', qrStartedAt);
        if (cancelled) return;
        setUploadStage(null);
        console.info(
          `[photo-flow] ready in ${Math.round(performance.now() - startedAt)}ms`,
          timings,
        );
        controllerRef.current?.generationComplete();
      } catch (cause) {
        setUploadStage(null);
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
  }, [state, capturedImage]);

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
  // The photographer stays on the left at every stage. The side-entry clip is
  // deliberately a right-side-only cue: putting it on the left made the
  // photographer disappear after its one-shot video ended.
  const showRightBlink = state === 'PERCEIVING';
  const rightVideoSrc = !showRightBlink
    ? null
    : introActive || guidanceActive
      ? BOOTH_VIDEO.arrival
      : BOOTH_VIDEO.gesture;
  const rightVideoLoops = rightVideoSrc === BOOTH_VIDEO.gesture;
  const captureSequenceActive =
    state === 'COUNTDOWN' ||
    state === 'CAPTURE' ||
    state === 'CREATE' ||
    state === 'RESULT';
  // The actual shutter action plays only once. Its trimmed final frame is a
  // camera-holding pose, which remains visible for the complete QR wait.
  const leftVideoSrc = captureSequenceActive
    ? BOOTH_VIDEO.captureHold
    : BOOTH_VIDEO.idle;
  const leftVideoLoops = leftVideoSrc === BOOTH_VIDEO.idle;
  const photoImage = portrait?.imageData ?? null;

  let speaker: 'left' | 'right' | null = null;
  let dialogueLines: [string, string?] | null = null;
  if (state === 'IDLE') {
    speaker = 'left';
    dialogueLines = ['嗨，来这边！', '站进取景框，我给你拍一张。'];
  } else if (state === 'PERCEIVING') {
    if (introActive) {
      speaker = 'left';
      dialogueLines = ['看到你啦！', '再往中间一点点，就很完美。'];
    } else if (guidanceActive) {
      speaker = 'left';
      dialogueLines = tooManyPeople
        ? ['人数有点多，', '我们分两组拍吧！']
        : capturePeopleCount > 0
          ? ['大家再靠近一点点，', '对，就站在一起！']
          : ['再往前走一点，', '让我看清你！'];
    } else {
      speaker = 'right';
      dialogueLines =
        taskPhaseMs < simpleMode.iSeeYouMs
          ? ['嘿，拍照前先和我打个招呼！', '给我看一个你喜欢的手势吧。']
          : GESTURE_TASK.lines;
    }
  } else if (state === 'LOCKED') {
    if (lockedConfirming) {
      speaker = 'right';
      dialogueLines = ['收到！这个姿势很不错！'];
    } else {
      speaker = 'left';
      dialogueLines = ['太好了，就保持这个姿势！', '看这里，我来数：3、2、1！'];
    }
  } else if (state === 'RESULT') {
    speaker = 'left';
    dialogueLines = ['拍好啦！你的未来照片已经出发。', '扫二维码带走，也去大屏找找自己吧！'];
  }

  const leftDialogueLines = speaker === 'left'
    ? dialogueLines
    : state === 'PERCEIVING'
      ? ['我看到你啦，保持在画面里！'] as [string]
      : state === 'LOCKED'
        ? ['很好，就保持住！', '马上为你拍下这一刻。'] as [string, string]
        : null;
  const rightDialogueLines = speaker === 'right'
    ? dialogueLines
    : state === 'PERCEIVING'
      ? GESTURE_TASK.lines
      : state === 'LOCKED'
        ? ['姿势识别成功！', '准备好，看镜头！'] as [string, string]
        : null;

  return (
    <main
      className="booth-v1"
      style={{ '--active': activeColor } as React.CSSProperties}
    >
      <div className="local-booth-badge">本地拍照端 · CLOUD SYNC</div>
      <section className="ai-mirror">
        <div className="kv-backdrop" aria-hidden="true" />
        <div className="kv-logo" aria-hidden="true">
          BOSCH
        </div>
        <div className="kv-headline" aria-hidden="true">
          <h2>竞速智联　共塑致远</h2>
          <p>Accelerate Innovation　Go Beyond Together</p>
        </div>

        <div className={`blink-slot blink-left state-${state.toLowerCase()}`}>
          <TransparentCharacterVideo
            key={leftVideoSrc}
            className="blink-video blink-video-left"
            src={leftVideoSrc}
            loop={leftVideoLoops}
          />
        </div>

        {leftDialogueLines && state !== 'COUNTDOWN' && (
          <div
            className={`blink-dialogue speaker-left state-${state.toLowerCase()}`}
            key={`${state}-left`}
          >
            {leftDialogueLines.map((line) => <p key={line}>{line}</p>)}
          </div>
        )}

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

          <div className={`blink-slot blink-right ${rightVideoSrc ? 'is-visible' : ''}`}>
            {rightVideoSrc && (
              <TransparentCharacterVideo
                key={rightVideoSrc}
                className="blink-video blink-video-right"
                src={rightVideoSrc}
                loop={rightVideoLoops}
              />
            )}
          </div>

          {rightDialogueLines && state !== 'COUNTDOWN' && (
            <div
              className={`blink-dialogue speaker-right state-${state.toLowerCase()}`}
              key={`${state}-right`}
            >
              {rightDialogueLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {((state === 'PERCEIVING' && phaseHeldMs >= taskStartsAt) ||
                lockedConfirming) && (
                <div className={`gesture-task ${lockedConfirming ? 'is-success' : ''}`}>
                  <span aria-hidden="true">{lockedConfirming ? '✓' : GESTURE_TASK.icon}</span>
                  <strong>{lockedConfirming ? '识别成功' : GESTURE_TASK.name}</strong>
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

          {state === 'CAPTURE' && capturedImage && !error && uploadStage && (
            <aside className="photo-claim-card is-preparing" role="status">
              <div className="qr-placeholder" aria-hidden="true">
                <i />
              </div>
              <div>
                <strong>请拿出手机准备扫码</strong>
                <span>二维码马上会出现在这里</span>
                <small>{UPLOAD_STAGE_COPY[uploadStage]} · {uploadElapsedSeconds} 秒</small>
              </div>
            </aside>
          )}

          {state === 'RESULT' && claimQr && portrait?.shortCode && (
            <aside className="photo-claim-card" aria-label="扫码下载照片">
              <img src={claimQr} alt="照片下载二维码" />
              <div>
                <strong>扫码下载照片</strong>
                <span>照片编号 {portrait.shortCode}</span>
              </div>
            </aside>
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
