import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ENERGY_CONFIG } from '../constants';
import { wallConfig } from '../config/wallConfig';
import { renderFuturePortrait } from '../services/portraitRenderer';
import type { BehaviorReading, PoseTrace, PrimaryEnergy } from '../types';

const ENERGIES = Object.keys(ENERGY_CONFIG) as PrimaryEnergy[];

/**
 * A standing figure in portrait-normalised coordinates. This page has no pose
 * detection, so CLEAN would otherwise show an empty frame — but this geometry
 * is invented, and will not line up with whoever is in the photo. It is here to
 * judge the treatment's weight and colour, not its registration. The real thing
 * is on `/booth`, where the halo is drawn from the capture's own trace.
 */
const PLACEHOLDER_POSE: PoseTrace[] = [
  {
    isInitiator: true,
    keypoints: (
      [
        ['nose', 0.5, 0.16],
        ['leftShoulder', 0.42, 0.26],
        ['rightShoulder', 0.58, 0.26],
        ['leftElbow', 0.36, 0.36],
        ['rightElbow', 0.64, 0.36],
        ['leftWrist', 0.32, 0.45],
        ['rightWrist', 0.7, 0.45],
        ['leftHip', 0.45, 0.44],
        ['rightHip', 0.55, 0.44],
        ['leftKnee', 0.44, 0.55],
        ['rightKnee', 0.56, 0.55],
        ['leftAnkle', 0.43, 0.63],
        ['rightAnkle', 0.57, 0.63],
      ] as const
    ).map(([name, x, y]) => ({ name, x, y, score: 1 })),
    hullPoints: [
      { x: 0.5, y: 0.13 },
      { x: 0.7, y: 0.45 },
      { x: 0.57, y: 0.63 },
      { x: 0.43, y: 0.63 },
      { x: 0.32, y: 0.45 },
    ],
  },
];

const READING: BehaviorReading = {
  peopleCount: 1,
  mode: 'Single',
  movement: 0.5,
  stability: 0.7,
  cohesion: 0.6,
  secondary: 'Precision',
};

// The resting wall lays photos out in this grid, so one tile is this share of a
// 1920-wide screen. Judging a treatment at that size is the only way to see how
// it will read from across the room.
const TILE_WIDTH = Math.round(
  wallConfig.layout.referenceWidthPx / wallConfig.scroll.columns,
);
const TILE_HEIGHT = Math.round(
  wallConfig.layout.referenceHeightPx / wallConfig.scroll.rows,
);

const panelStyle: React.CSSProperties = {
  background: '#0b1218',
  border: '1px solid rgba(123,213,239,.25)',
  padding: 16,
};

export default function FilterComparePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Record<string, string>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1440, height: 1080 } })
      .then((next) => {
        stream = next;
        if (videoRef.current) videoRef.current.srcObject = next;
      })
      .catch((error: unknown) =>
        setCameraError(
          error instanceof Error ? error.message : 'Camera unavailable',
        ),
      );
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    setSource(canvas.toDataURL('image/jpeg', 0.92));
  }, []);

  const pickFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource(String(reader.result));
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setBusy(true);
    Promise.all(
      ENERGIES.map(async (energy) => {
        const record = await renderFuturePortrait(
          source,
          energy,
          READING,
          undefined,
          PLACEHOLDER_POSE,
        );
        return [energy, record.imageData] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setRendered(Object.fromEntries(pairs));
        setBusy(false);
      })
      .catch(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 28,
        background: '#061016',
        color: '#dff8ff',
        fontFamily: 'Courier New, monospace',
      }}
    >
      <p style={{ color: '#7bd5ef', letterSpacing: '.12em', margin: 0 }}>
        PORTRAIT PREVIEW — THE FOUR ENERGIES
      </p>
      <h1 style={{ margin: '6px 0 8px', fontSize: 24 }}>
        One capture, the four colours it can come back in
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: 12, color: '#7bd5ef' }}>
        The wall holds all four at once, so they have to survive each other. The
        halo never draws on the face.
      </p>

      <section style={{ ...panelStyle, marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: 300, background: '#02080c', transform: 'scaleX(-1)' }}
            />
            {cameraError && (
              <p style={{ color: '#ff9aa5', fontSize: 12, width: 300 }}>
                {cameraError} — use the file picker instead.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              type="button"
              onClick={grabFrame}
              style={{
                padding: '12px 20px',
                background: '#e2001a',
                color: '#fff',
                border: 0,
                cursor: 'pointer',
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              CAPTURE FROM CAMERA
            </button>
            <label style={{ fontSize: 12, cursor: 'pointer' }}>
              …or pick a photo file{' '}
              <input type="file" accept="image/*" onChange={pickFile} />
            </label>
            <p style={{ fontSize: 11, color: '#ffcf6b', maxWidth: 320, lineHeight: 1.6 }}>
              halo 由真实 poseTrace 驱动。本页没有姿态检测,所以用了一个
              <strong> 占位姿态</strong>——它不会对准照片里的人。要看真实贴合效果,
              去 /booth 走一次完整流程。
            </p>
          </div>
        </div>
      </section>

      {!source && (
        <p style={{ color: '#7bd5ef' }}>Capture or pick a photo to compare.</p>
      )}
      {busy && <p>RENDERING…</p>}

      {source && !busy && (
        <>
          <h2 style={{ fontSize: 15, letterSpacing: 1 }}>
            AT RESULT-SCREEN SIZE
          </h2>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 34 }}>
            {ENERGIES.map((energy) => (
              <figure key={energy} style={{ margin: 0, width: 300 }}>
                <img
                  src={rendered[energy]}
                  alt={ENERGY_CONFIG[energy].label}
                  style={{ width: '100%', display: 'block', border: '1px solid #1d2b35' }}
                />
                <figcaption style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
                  <strong style={{ color: ENERGY_CONFIG[energy].accent }}>
                    {ENERGY_CONFIG[energy].label}
                  </strong>
                  <br />
                  <span style={{ color: '#7bd5ef' }}>
                    {ENERGY_CONFIG[energy].description}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>

          <h2 style={{ fontSize: 15, letterSpacing: 1 }}>
            AT WALL TILE SIZE ({TILE_WIDTH}×{TILE_HEIGHT}, THE RESTING RIVER)
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ENERGIES.map((energy) => (
              <figure key={energy} style={{ margin: 0 }}>
                <div
                  style={{
                    width: TILE_WIDTH / 2,
                    height: TILE_HEIGHT / 2,
                    overflow: 'hidden',
                    border: '1px solid #1d2b35',
                  }}
                >
                  <img
                    src={rendered[energy]}
                    alt={`${ENERGY_CONFIG[energy].label} at tile size`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <figcaption style={{ fontSize: 11, marginTop: 6, color: '#fff' }}>
                  {ENERGY_CONFIG[energy].label}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
