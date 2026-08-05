import React, { useRef, useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { analyzeParticipantImage } from '../services/geminiService';
import { Participant } from '../types';
import { FilesetResolver, GestureRecognizer, ImageSegmenter } from '@mediapipe/tasks-vision';
import { audioService, SOUND_KEYS } from '../services/audioService';
import { sendPrintJob } from '../services/printService';
import { EVENT_SLOGAN, BOOTH_BG_SRC, BOOTH_BG_STORAGE_KEY } from '../constants';

/** Compress uploaded bg for localStorage + canvas draw */
function compressBgDataUrl(src: string, maxSide = 1920, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => reject(new Error('Failed to read background image'));
    img.src = src;
  });
}

function loadBgImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Background failed: ${src.slice(0, 48)}`));
    img.src = src;
  });
}

interface PhotoBoothProps {
  onComplete: (participant: Participant) => void;
  participantCount: number;
}

enum Step {
  IDLE,
  COUNTDOWN,
  FLASH,
  PRINTING,
  DEVELOPING,
  REVEAL,
  DONE,
}

/** Working resolution for realtime cutout (speed) */
const SEG_MAX_W = 640;

const CameraBody = ({ children }: { children?: React.ReactNode }) => (
  <div className="relative w-full max-w-[320px] sm:max-w-md mx-auto z-20">
    <div className="bg-[#f0f0eb] rounded-t-3xl rounded-b-[2rem] p-5 pb-8 shadow-[0_20px_40px_rgba(0,0,0,0.6)] relative z-20">
      <div className="absolute top-1/2 left-0 right-0 h-14 flex flex-col justify-center pointer-events-none opacity-90">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <div className="w-full h-1.5 bg-[#ff385c]"></div>
          <div className="w-full h-1.5 bg-[#ffb636]"></div>
          <div className="w-full h-1.5 bg-[#31c431]"></div>
          <div className="w-full h-1.5 bg-[#36a9e1]"></div>
        </div>
      </div>

      <div className="relative w-full aspect-square bg-[#1a1a1a] rounded-full border-8 border-[#2a2a2a] shadow-inner overflow-hidden mx-auto mt-2 z-10 ring-1 ring-white/10">
        <div className="absolute top-4 right-8 w-10 h-6 bg-white/10 rounded-full blur-md z-30 pointer-events-none"></div>
        {children}
      </div>

      <div className="flex justify-between items-center mt-6 px-2">
        <div className="w-10 h-10 bg-[#2a2a2a] rounded-lg border-2 border-white/10 flex items-center justify-center">
          <div className="w-6 h-1.5 bg-yellow-900/50 rounded-full"></div>
        </div>
        <div className="font-black text-xl tracking-tighter text-[#1a1a1a] opacity-80 font-sans transform scale-90 text-right">
          Supplier Day
          <span className="text-[10px] align-top opacity-50 block leading-none">2026</span>
        </div>
        <div className="w-3 h-3 rounded-full bg-red-600 shadow-sm border border-red-800"></div>
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-3/4 h-2 bg-gray-800/20 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]"></div>
    </div>

    <div className="absolute -bottom-2 left-8 right-8 h-6 bg-[#dcdcd9] rounded-b-xl z-10 shadow-lg flex items-end justify-center">
      <div className="w-2/3 h-1 bg-black/10 rounded-full mb-1"></div>
    </div>
  </div>
);

/** Cover/fill — scale to fill destination, crop overflow (no black bars) */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  sw?: number,
  sh?: number
) {
  const iw =
    sw ??
    (img as HTMLVideoElement).videoWidth ??
    (img as HTMLImageElement).naturalWidth ??
    (img as HTMLCanvasElement).width;
  const ih =
    sh ??
    (img as HTMLVideoElement).videoHeight ??
    (img as HTMLImageElement).naturalHeight ??
    (img as HTMLCanvasElement).height;
  if (!iw || !ih) return;
  const srcAspect = iw / ih;
  const dstAspect = dw / dh;
  let tw = dw;
  let th = dh;
  if (srcAspect > dstAspect) {
    // source wider → fill height, crop sides
    tw = dh * srcAspect;
  } else {
    // source taller → fill width, crop top/bottom
    th = dw / srcAspect;
  }
  const tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  ctx.drawImage(img as CanvasImageSource, 0, 0, iw, ih, tx, ty, tw, th);
}

export const PhotoBooth: React.FC<PhotoBoothProps> = ({ onComplete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const personCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [step, setStep] = useState<Step>(Step.IDLE);
  const [printerName, setPrinterName] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ vibe: string; color: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cutoutReady, setCutoutReady] = useState(false);
  const [cutoutEnabled, setCutoutEnabled] = useState(true);
  const [cutoutError, setCutoutError] = useState<string | null>(null);
  const [hasCustomBg, setHasCustomBg] = useState(false);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [pendingBgSrc, setPendingBgSrc] = useState<string | null>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [detectedGesture, setDetectedGesture] = useState('');
  const gestureHoldStartRef = useRef(0);
  const activeGestureNameRef = useRef<string | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastGestureTimeRef = useRef(-1);
  const lastSegTsRef = useRef(0);
  const stepRef = useRef(step);
  const cutoutEnabledRef = useRef(cutoutEnabled);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    cutoutEnabledRef.current = cutoutEnabled;
  }, [cutoutEnabled]);

  useEffect(() => {
    audioService.init();
  }, []);

  // Preload booth background (custom from localStorage, else default)
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const saved = localStorage.getItem(BOOTH_BG_STORAGE_KEY);
      const src = saved || BOOTH_BG_SRC;
      try {
        const img = await loadBgImage(src);
        if (cancelled) return;
        bgImageRef.current = img;
        setHasCustomBg(Boolean(saved));
      } catch (e) {
        console.error('Booth background failed to load', src.slice(0, 64), e);
        if (saved) {
          localStorage.removeItem(BOOTH_BG_STORAGE_KEY);
          try {
            const fallback = await loadBgImage(BOOTH_BG_SRC);
            if (!cancelled) {
              bgImageRef.current = fallback;
              setHasCustomBg(false);
            }
          } catch (err) {
            console.error('Default booth background failed', err);
          }
        }
      }
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBackground = useCallback(async (src: string, persist: boolean) => {
    setBgBusy(true);
    try {
      const img = await loadBgImage(src);
      bgImageRef.current = img;
      if (persist) {
        try {
          localStorage.setItem(BOOTH_BG_STORAGE_KEY, src);
        } catch (e) {
          console.warn('Failed to persist background (quota?)', e);
        }
        setHasCustomBg(true);
      } else {
        localStorage.removeItem(BOOTH_BG_STORAGE_KEY);
        setHasCustomBg(false);
      }
      setPendingBgSrc(null);
      setBgPickerOpen(false);
    } catch (e) {
      console.error(e);
      alert('背景图加载失败，请换一张图片试试');
    } finally {
      setBgBusy(false);
    }
  }, []);

  const openBgPicker = useCallback(() => {
    if (stepRef.current !== Step.IDLE) return;
    setPendingBgSrc(null);
    setBgPickerOpen(true);
    // Defer so modal mounts before native file dialog
    window.setTimeout(() => bgFileInputRef.current?.click(), 50);
  }, []);

  const onBgFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setBgBusy(true);
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const compressed = await compressBgDataUrl(raw);
      setPendingBgSrc(compressed);
      setBgPickerOpen(true);
    } catch (err) {
      console.error(err);
      alert('读取图片失败');
    } finally {
      setBgBusy(false);
    }
  }, []);

  const restoreDefaultBg = useCallback(async () => {
    await applyBackground(BOOTH_BG_SRC, false);
  }, [applyBackground]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      openBgPicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openBgPicker]);

  useEffect(() => {
    const loadModels = async () => {
      setCutoutError(null);
      try {
        // Local WASM (no CDN) — works on corporate network
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

        // Segmenter first (critical for cutout) — local tflite
        const makeSegmenter = async (delegate: 'GPU' | 'CPU') =>
          ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/mediapipe/selfie_segmenter_landscape.tflite',
              delegate,
            },
            runningMode: 'VIDEO',
            outputCategoryMask: true,
            outputConfidenceMasks: true,
          });

        try {
          segmenterRef.current = await makeSegmenter('GPU');
        } catch {
          console.warn('GPU segmenter failed, falling back to CPU');
          segmenterRef.current = await makeSegmenter('CPU');
        }
        setCutoutReady(true);

        // Gesture is optional — don't block cutout if Google model blocked
        try {
          gestureRecognizerRef.current = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.3,
            minHandPresenceConfidence: 0.3,
            minTrackingConfidence: 0.3,
          });
        } catch (ge) {
          console.warn('Gesture model unavailable (network). Use click/countdown only.', ge);
        }

        setIsModelLoading(false);
      } catch (error) {
        console.error('Cutout model load failed', error);
        setCutoutError('抠图模型加载失败');
        setCutoutReady(false);
        setIsModelLoading(false);
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(localStream);
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error('Camera fail', err);
      }
    };
    startCamera();
    return () => {
      active = false;
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  /** Composite one frame: background image + cutout person (mirrored) */
  const renderCutoutFrame = useCallback((video: HTMLVideoElement, timestamp: number) => {
    const preview = previewCanvasRef.current;
    const segmenter = segmenterRef.current;
    if (!preview || video.videoWidth === 0) return;

    // MediaPipe requires strictly increasing timestamps
    if (timestamp <= lastSegTsRef.current) timestamp = lastSegTsRef.current + 1;
    lastSegTsRef.current = timestamp;

    const pw = preview.width;
    const ph = preview.height;
    if (pw < 2 || ph < 2) return;
    const pctx = preview.getContext('2d', { willReadFrequently: false });
    if (!pctx) return;

    // 1) Background
    pctx.fillStyle = '#0a0a12';
    pctx.fillRect(0, 0, pw, ph);
    if (bgImageRef.current?.complete && bgImageRef.current.naturalWidth > 0) {
      drawImageCover(pctx, bgImageRef.current, 0, 0, pw, ph);
    }

    if (!cutoutEnabledRef.current || !segmenter) {
      pctx.save();
      pctx.translate(pw, 0);
      pctx.scale(-1, 1);
      drawImageCover(pctx, video, 0, 0, pw, ph);
      pctx.restore();
      return;
    }

    if (!personCanvasRef.current) personCanvasRef.current = document.createElement('canvas');
    const person = personCanvasRef.current;
    const personCtx = person.getContext('2d', { willReadFrequently: true });
    if (!personCtx) return;

    try {
      // Segment the live video (native size) — mask size comes from model
      const result = segmenter.segmentForVideo(video, timestamp);
      const confMask = result.confidenceMasks?.[0];
      const catMask = result.categoryMask;

      const mw = confMask?.width || catMask?.width || video.videoWidth;
      const mh = confMask?.height || catMask?.height || video.videoHeight;
      if (person.width !== mw || person.height !== mh) {
        person.width = mw;
        person.height = mh;
      }
      personCtx.drawImage(video, 0, 0, mw, mh);
      const frame = personCtx.getImageData(0, 0, mw, mh);
      const px = frame.data;
      const n = mw * mh;

      if (confMask) {
        const maskData = confMask.getAsFloat32Array();
        let sum = 0;
        const step = Math.max(1, Math.floor(maskData.length / 200));
        for (let i = 0; i < maskData.length; i += step) sum += maskData[i];
        const avg = sum / Math.ceil(maskData.length / step);
        const invert = avg > 0.65;
        for (let i = 0; i < n; i++) {
          let a = maskData[i] ?? 0;
          if (invert) a = 1 - a;
          a = a < 0.25 ? 0 : a > 0.6 ? 1 : (a - 0.25) / 0.35;
          px[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
        }
        confMask.close?.();
      } else if (catMask) {
        const maskData = catMask.getAsUint8Array();
        for (let i = 0; i < n; i++) {
          px[i * 4 + 3] = maskData[i] === 0 ? 0 : 255;
        }
        catMask.close?.();
      } else {
        result.close?.();
        pctx.save();
        pctx.translate(pw, 0);
        pctx.scale(-1, 1);
        drawImageCover(pctx, video, 0, 0, pw, ph);
        pctx.restore();
        return;
      }

      personCtx.putImageData(frame, 0, 0);
      result.close?.();

      pctx.save();
      pctx.translate(pw, 0);
      pctx.scale(-1, 1);
      drawImageCover(pctx, person, 0, 0, pw, ph, mw, mh);
      pctx.restore();
    } catch (e) {
      console.warn('segment frame failed', e);
      pctx.save();
      pctx.translate(pw, 0);
      pctx.scale(-1, 1);
      drawImageCover(pctx, video, 0, 0, pw, ph);
      pctx.restore();
    }
  }, []);

  // Realtime preview + gesture loop
  useEffect(() => {
    let frameId = 0;
    let running = true;

    const loop = () => {
      if (!running) return;
      const video = videoRef.current;
      const preview = previewCanvasRef.current;
      const currentStep = stepRef.current;

      if (
        video &&
        preview &&
        video.readyState >= 2 &&
        (currentStep === Step.IDLE || currentStep === Step.COUNTDOWN || currentStep === Step.FLASH)
      ) {
        // Size canvas to lens CSS pixels * dpr (capped)
        const rect = preview.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const tw = Math.max(2, Math.round(rect.width * dpr));
        const th = Math.max(2, Math.round(rect.height * dpr));
        if (preview.width !== tw || preview.height !== th) {
          preview.width = tw;
          preview.height = th;
        }

        const now = performance.now();
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          renderCutoutFrame(video, now);

          // Gesture only in IDLE, throttle a bit
          if (
            currentStep === Step.IDLE &&
            gestureRecognizerRef.current &&
            now - lastGestureTimeRef.current > 80
          ) {
            lastGestureTimeRef.current = now;
            try {
              const result = gestureRecognizerRef.current.recognizeForVideo(video, now);
              let foundGesture = '';
              for (const hands of result.gestures) {
                if (hands.length > 0) {
                  const category = hands[0].categoryName;
                  const score = hands[0].score;
                  if (
                    (category === 'Victory' ||
                      category === 'Thumb_Up' ||
                      category === 'Open_Palm' ||
                      category === 'ILoveYou') &&
                    score > 0.4
                  ) {
                    foundGesture = category;
                    break;
                  }
                }
              }
              if (foundGesture) {
                if (activeGestureNameRef.current === foundGesture) {
                  if (Date.now() - gestureHoldStartRef.current > 600) {
                    startCountdown();
                    setDetectedGesture('CAPTURING!');
                  } else {
                    setDetectedGesture(foundGesture);
                  }
                } else {
                  activeGestureNameRef.current = foundGesture;
                  gestureHoldStartRef.current = Date.now();
                  audioService.playLock(0.2);
                  setDetectedGesture(foundGesture);
                }
              } else {
                activeGestureNameRef.current = null;
                setDetectedGesture('');
              }
            } catch {
              // ignore
            }
          }
        }
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, [renderCutoutFrame, isModelLoading]);

  const startCountdown = () => {
    setStep(Step.COUNTDOWN);
    setCountdown(3);
    audioService.playBeep(880, 0.1);
  };

  useEffect(() => {
    if (step === Step.COUNTDOWN && countdown !== null) {
      if (countdown > 0) {
        const t = setTimeout(() => {
          setCountdown(countdown - 1);
          if (countdown - 1 > 0) audioService.playBeep(880, 0.1);
          else audioService.playBeep(1760, 0.2);
        }, 1000);
        return () => clearTimeout(t);
      }
      doCapture();
    }
  }, [countdown, step]);

  const handleReset = () => {
    setStep(Step.IDLE);
    setCapturedImage(null);
    setAnalysis(null);
    setCountdown(null);
    setDetectedGesture('');
  };

  /** Capture current cutout preview → 6×4 JPEG (contain, no subject crop) */
  const captureFromPreview = (): string => {
    const preview = previewCanvasRef.current;
    if (!preview) return '';
    const outW = 1800;
    const outH = 1200;
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);
    drawImageCover(ctx, preview, 0, 0, outW, outH);
    return out.toDataURL('image/jpeg', 0.92);
  };

  const doCapture = async () => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      setStep(Step.IDLE);
      return;
    }

    setStep(Step.FLASH);

    try {
      // One last composite before freeze
      renderCutoutFrame(videoRef.current, performance.now());
      const optimizedUrl = captureFromPreview();
      if (!optimizedUrl) throw new Error('Empty capture');
      setCapturedImage(optimizedUrl);

      const initialParticipant: Participant = {
        id: uuidv4(),
        imageData: optimizedUrl,
        timestamp: Date.now(),
        vibe: '...',
        color: '#333',
      };

      setTimeout(() => {
        setStep(Step.PRINTING);
        audioService.play(SOUND_KEYS.PRINT, 0.8);
      }, 200);

      analyzeParticipantImage(optimizedUrl)
        .then((res) => {
          setAnalysis(res);
          setStep(Step.DEVELOPING);
          setTimeout(() => {
            setStep(Step.REVEAL);
            audioService.playPop(0.3);
            setTimeout(() => {
              sendPrintJob(optimizedUrl, printerName)
                .then((data) => console.log('Print response:', data))
                .catch((err) => console.error('Auto-print failed:', err));
            }, 500);
            setTimeout(() => {
              onComplete({ ...initialParticipant, vibe: res.vibe, color: res.color });
              setStep(Step.DONE);
              audioService.playSwoosh(0.15);
              setTimeout(() => handleReset(), 2500);
            }, 3500);
          }, 2500);
        })
        .catch((err) => {
          console.error('Gemini analysis failed', err);
          onComplete({ ...initialParticipant, vibe: 'READY', color: '#00A4FD' });
          setStep(Step.DONE);
          setTimeout(() => handleReset(), 4000);
        });
    } catch (err) {
      console.error('Critical capture error', err);
      handleReset();
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-start pt-12 sm:pt-24 font-sans select-none">
      <div className="absolute top-4 left-4 z-[200] flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border bg-blue-500/20 border-blue-500/50 text-blue-300 backdrop-blur-md">
          <span className="text-xs font-bold tracking-wider uppercase">6寸自动打印</span>
        </div>
        <button
          type="button"
          onClick={() => setCutoutEnabled((v) => !v)}
          className={`px-4 py-2 rounded-full border text-xs font-bold tracking-wider uppercase backdrop-blur-md transition-colors ${
            cutoutError
              ? 'bg-red-500/20 border-red-500/50 text-red-300'
              : cutoutEnabled
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-black/40 border-white/10 text-white/50'
          }`}
        >
          {cutoutError
            ? cutoutError
            : `实时抠图 ${cutoutEnabled ? (cutoutReady ? 'ON' : '加载中…') : 'OFF'}`}
        </button>
        {step === Step.IDLE && (
          <button
            type="button"
            onClick={openBgPicker}
            className={`px-4 py-2 rounded-full border text-xs font-bold tracking-wider uppercase backdrop-blur-md transition-colors ${
              hasCustomBg
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
            }`}
          >
            换背景 C{hasCustomBg ? ' · 自定义' : ''}
          </button>
        )}
        {step === Step.IDLE && (
          <button
            type="button"
            onClick={startCountdown}
            className="px-4 py-2 rounded-full border bg-white/10 border-white/20 text-white text-xs font-bold tracking-wider uppercase backdrop-blur-md hover:bg-white/20"
          >
            手动拍照
          </button>
        )}
        <input
          ref={bgFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onBgFileChange}
        />
        <input
          type="text"
          value={printerName}
          onChange={(e) => setPrinterName(e.target.value)}
          placeholder="打印机名称（可选）"
          className="bg-black/40 border border-white/10 text-white text-xs px-3 py-2 rounded-full outline-none focus:border-blue-500/50 backdrop-blur-md w-40"
        />
      </div>

      {bgPickerOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0f172a] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold tracking-wide">更换抠图背景</h3>
                <p className="text-white/40 text-xs mt-1">按 C 打开 · 上传后预览，确认即生效</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBgPickerOpen(false);
                  setPendingBgSrc(null);
                }}
                className="text-white/50 hover:text-white text-sm px-2 py-1"
              >
                关闭
              </button>
            </div>

            <div className="p-5">
              <div className="aspect-video rounded-xl overflow-hidden bg-black border border-white/10 mb-4">
                {pendingBgSrc ? (
                  <img src={pendingBgSrc} alt="背景预览" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white/35 gap-2 text-sm">
                    <span>尚未选择新背景</span>
                    <span className="text-xs text-white/25">
                      当前：{hasCustomBg ? '自定义背景' : '默认 booth-bg'}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={bgBusy}
                  onClick={() => bgFileInputRef.current?.click()}
                  className="px-4 py-2 rounded-full bg-white text-slate-900 text-xs font-bold uppercase tracking-wider hover:bg-white/90 disabled:opacity-50"
                >
                  {bgBusy ? '处理中…' : '上传图片'}
                </button>
                <button
                  type="button"
                  disabled={bgBusy || !pendingBgSrc}
                  onClick={() => pendingBgSrc && applyBackground(pendingBgSrc, true)}
                  className="px-4 py-2 rounded-full bg-emerald-500/90 text-white text-xs font-bold uppercase tracking-wider hover:bg-emerald-500 disabled:opacity-40"
                >
                  确认应用
                </button>
                <button
                  type="button"
                  disabled={bgBusy}
                  onClick={restoreDefaultBg}
                  className="px-4 py-2 rounded-full border border-white/20 text-white/70 text-xs font-bold uppercase tracking-wider hover:bg-white/10 disabled:opacity-50"
                >
                  恢复默认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`absolute top-20 sm:top-32 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full border border-white/10 opacity-0 transition-opacity duration-1000 ${
          step >= Step.PRINTING ? 'opacity-100' : 'opacity-0'
        } pointer-events-none`}
      >
        <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-spin-slow"></div>
        <div className="absolute inset-4 rounded-full border border-purple-500/20 animate-reverse-spin"></div>
      </div>

      {step === Step.IDLE && (
        <div className="absolute left-0 top-0 bottom-0 w-32 sm:w-48 flex flex-col items-center justify-center z-50 pointer-events-none bg-gradient-to-r from-black/80 via-black/40 to-transparent pl-4">
          <div className="animate-pulse flex flex-col items-center gap-6">
            <div className="flex flex-col items-center text-center gap-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
              <h2 className="text-3xl font-black text-white leading-none tracking-tighter">
                LOOK
                <br />
                AT CAMERA
              </h2>
              <span className="text-xl font-bold text-brand-accent">请看摄像头</span>
            </div>
            <div className="w-12 h-[1px] bg-white/30 my-2"></div>
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl">✌️</div>
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl">👍</div>
              </div>
              <div className="flex flex-col items-center text-center gap-1 opacity-90">
                <span className="text-xs font-bold text-white tracking-widest uppercase">GESTURE TO SNAP</span>
                <span className="text-xs font-bold text-brand-accent">比个手势拍照</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full px-8 flex flex-col items-center transition-all duration-500" style={{ transform: 'scale(0.95)' }}>
        <CameraBody>
          <div className="relative w-full h-full bg-black overflow-hidden rounded-full">
            {/* Hidden camera feed — used for MediaPipe */}
            {/* Camera feed — full size but invisible (1×1 breaks frame decode) */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
            />

            {/* Live cutout composite */}
            <canvas
              ref={previewCanvasRef}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                capturedImage && step >= Step.PRINTING ? 'opacity-0' : 'opacity-100'
              }`}
            />

            {capturedImage && step === Step.FLASH && (
              <div className="absolute inset-0 bg-white z-50 animate-fade-out"></div>
            )}

            {step === Step.IDLE && detectedGesture && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-40 pointer-events-none">
                <p className="text-sm font-bold uppercase tracking-widest text-brand-accent drop-shadow-md bg-black/50 px-3 py-1 rounded-full animate-pulse">
                  HOLD STILL...
                </p>
              </div>
            )}

            {step === Step.COUNTDOWN && countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-[2px]">
                <span className="text-8xl font-black text-white drop-shadow-2xl animate-ping">
                  {countdown === 0 ? '' : countdown}
                </span>
              </div>
            )}
          </div>
        </CameraBody>

        {step >= Step.PRINTING && capturedImage && (
          <div className="absolute top-[96%] left-1/2 -translate-x-1/2 w-[300px] z-10 pointer-events-none" style={{ perspective: '1200px' }}>
            <div
              className={`transition-all duration-[2000ms] ease-in-out origin-center ${
                step === Step.DONE ? 'translate-x-[600px] -translate-y-[800px] scale-0 rotate-12 opacity-0' : ''
              }`}
            >
              <div
                id="printable-polaroid"
                className="bg-white p-3 shadow-2xl animate-print-photo origin-top transition-all relative flex flex-col rounded-sm print-reset"
              >
                <div className="aspect-[3/2] bg-black overflow-hidden relative shadow-[inset_0_1px_4px_rgba(0,0,0,0.1)] shrink-0">
                  <img
                    src={capturedImage}
                    className={`w-full h-full object-cover transition-all duration-300 ${
                      step >= Step.DEVELOPING ? 'animate-develop opacity-100' : 'opacity-0'
                    }`}
                    alt="Captured"
                  />
                </div>
                <div className="h-24 flex flex-col items-center justify-start pt-5 text-center px-2 shrink-0">
                  {analysis && (
                    <div className={`transition-opacity duration-1000 ${step >= Step.REVEAL ? 'opacity-100' : 'opacity-0'}`}>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase leading-none mb-1">
                        {analysis.vibe}
                      </h2>
                      <span className="text-[10px] font-serif italic text-zinc-400 tracking-wide mt-1 block">
                        {EVENT_SLOGAN.primary}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
