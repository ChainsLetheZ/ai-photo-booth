import React, { useEffect, useRef } from 'react';
import type { ImageSegmenter as ImageSegmenterInstance } from '@mediapipe/tasks-vision';
import { getVisionFileset } from '../perception/visionFiles';

const assetBase = import.meta.env?.BASE_URL ?? '/';
let segmenterPromise: Promise<ImageSegmenterInstance> | null = null;
let segmentationQueue = Promise.resolve();

function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = Promise.all([
      getVisionFileset(),
      import('@mediapipe/tasks-vision'),
    ]).then(([fileset, { ImageSegmenter }]) =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${assetBase}mediapipe/models/selfie_segmenter_landscape.tflite`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    );
  }
  return segmenterPromise;
}

interface TransparentCharacterVideoProps {
  key?: React.Key;
  className: string;
  src: string;
  loop?: boolean;
  /** Play the clip forwards and backwards continuously without exposing its end frame. */
  pingPong?: boolean;
  /** Play once, then keep the final pose visible instead of leaving a blank frame. */
  holdAtEnd?: boolean;
  freezeAt?: 'start' | 'end';
}

export default function TransparentCharacterVideo({
  className,
  src,
  loop = true,
  pingPong = false,
  holdAtEnd = false,
  freezeAt,
}: TransparentCharacterVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let lastSegmentedAt = 0;
    const maskCanvas = document.createElement('canvas');
    const maskContext = maskCanvas.getContext('2d');

    const render = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(render);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !maskContext || video.readyState < 2) return;
      if (now - lastSegmentedAt < 100) return;
      lastSegmentedAt = now;

      segmentationQueue = segmentationQueue.then(async () => {
        if (stopped || !video.videoWidth || !video.videoHeight) return;
        const segmenter = await getSegmenter();
        if (stopped) return;
        const result = segmenter.segmentForVideo(video, performance.now());
        const mask = result.confidenceMasks?.[0];
        if (!mask) return;
        const width = video.videoWidth;
        const height = video.videoHeight;
        canvas.width = width;
        canvas.height = height;
        maskCanvas.width = mask.width;
        maskCanvas.height = mask.height;
        const values = mask.getAsFloat32Array();
        const pixels = maskContext.createImageData(mask.width, mask.height);
        for (let index = 0; index < values.length; index += 1) {
          const alpha = Math.round(Math.max(0, Math.min(1, (values[index] - .12) / .7)) * 255);
          const offset = index * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 255;
          pixels.data[offset + 2] = 255;
          pixels.data[offset + 3] = alpha;
        }
        maskContext.putImageData(pixels, 0, 0);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
        context.drawImage(video, 0, 0, width, height);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(maskCanvas, 0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
      }).catch(() => {
        // Keep the animation unobtrusive if segmentation is unavailable.
      });
    };

    frame = requestAnimationFrame(render);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !pingPong || freezeAt) return undefined;

    let cancelled = false;
    let frame = 0;
    let direction = 1;
    let lastStepAt = 0;
    const edge = 0.06;
    const stepMs = 1000 / 30;

    const step = (now: number) => {
      if (cancelled) return;
      frame = requestAnimationFrame(step);
      if (now - lastStepAt < stepMs || video.readyState < 1) return;
      lastStepAt = now;
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= edge * 2) return;

      // Drive the timeline ourselves so the final transparent/empty frames
      // never flash and the companion always returns naturally.
      const next = video.currentTime + direction * (stepMs / 1000);
      if (next >= duration - edge) {
        direction = -1;
        video.currentTime = duration - edge;
      } else if (next <= edge) {
        direction = 1;
        video.currentTime = edge;
      } else {
        video.currentTime = next;
      }
    };

    const start = () => {
      if (cancelled) return;
      video.pause();
      video.currentTime = 0;
      frame = requestAnimationFrame(step);
    };

    if (video.readyState >= 1) start();
    else video.addEventListener('loadedmetadata', start, { once: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      video.removeEventListener('loadedmetadata', start);
    };
  }, [freezeAt, pingPong, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !holdAtEnd || pingPong || freezeAt) return undefined;

    const holdFinalFrame = () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0.05) {
        video.currentTime = duration - 0.05;
      }
      void video.pause();
    };

    video.addEventListener('ended', holdFinalFrame);
    return () => video.removeEventListener('ended', holdFinalFrame);
  }, [freezeAt, holdAtEnd, pingPong, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !freezeAt) return undefined;

    let cancelled = false;
    const freeze = () => {
      if (cancelled) return;
      const targetTime =
        freezeAt === 'end'
          ? Math.max(0, (video.duration || 0) - 0.05)
          : 0;
      video.currentTime = targetTime;
      void video.pause();
    };

    if (video.readyState >= 1) freeze();
    else video.addEventListener('loadedmetadata', freeze, { once: true });

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', freeze);
    };
  }, [freezeAt, src]);

  return (
    <>
      <video
        ref={videoRef}
        className="blink-video-source"
        src={src}
        autoPlay={!pingPong && !freezeAt}
        loop={loop && !pingPong && !holdAtEnd && !freezeAt}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <canvas ref={canvasRef} className={className} aria-hidden="true" />
    </>
  );
}
