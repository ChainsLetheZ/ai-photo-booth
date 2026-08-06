import { ENERGY_CONFIG, SECONDARY_COPY } from '../constants';
import type {
  BehaviorReading,
  PortraitRecord,
  PoseTrace,
  PoseTracePoint,
  PrimaryEnergy,
} from '../types';
import { getCoverSourceRect } from '../utils/viewportTransform';
import { convexHull } from './poseTrace';

function coverImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const source = getCoverSourceRect(
    sourceWidth,
    sourceHeight,
    width,
    height,
  );
  context.drawImage(
    image,
    source.sx,
    source.sy,
    source.sw,
    source.sh,
    x,
    y,
    width,
    height,
  );
}

function hexToRgb(hex: string) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((character) => character + character)
          .join('')
      : value;
  const number = Number.parseInt(full, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

/** Pushes a hull outward from its own centre so it clears the body. */
function expandHull(hull: PoseTracePoint[], padding: number) {
  if (hull.length < 3) return hull;
  const centreX = hull.reduce((sum, point) => sum + point.x, 0) / hull.length;
  const centreY = hull.reduce((sum, point) => sum + point.y, 0) / hull.length;
  return hull.map((point) => {
    const dx = point.x - centreX;
    const dy = point.y - centreY;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / distance) * padding,
      y: point.y + (dy / distance) * padding,
    };
  });
}

/** Evenly spaced points along a closed outline, used for the halo particles. */
function sampleOutline(outline: PoseTracePoint[], spacing: number) {
  const samples: PoseTracePoint[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index];
    const end = outline[(index + 1) % outline.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.round(length / spacing));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      samples.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
    }
  }
  return samples;
}

function strokeOutline(
  context: CanvasRenderingContext2D,
  outline: PoseTracePoint[],
) {
  context.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.stroke();
}

/**
 * Replaces the nose with a point above the crown, so an outline built from it
 * passes over the head instead of across the face. Head height is estimated
 * from shoulder width, which is the only body measure the trace reliably has.
 */
function headClearedHull(
  points: Map<string, PoseTracePoint>,
  fallback: PoseTracePoint[],
) {
  const nose = points.get('nose');
  const left = points.get('leftShoulder');
  const right = points.get('rightShoulder');
  const body = [...points.entries()]
    .filter(([name]) => name !== 'nose')
    .map(([, point]) => point);
  if (!nose || !left || !right || body.length < 2) return fallback;

  const shoulderWidth = Math.hypot(right.x - left.x, right.y - left.y);
  const neckX = (left.x + right.x) / 2;
  const neckY = (left.y + right.y) / 2;
  const dx = nose.x - neckX;
  const dy = nose.y - neckY;
  const distance = Math.hypot(dx, dy) || 1;
  const crown = {
    x: nose.x + (dx / distance) * shoulderWidth * 0.62,
    y: nose.y + (dy / distance) * shoulderWidth * 0.62,
  };
  return convexHull([...body, crown]);
}

/**
 * The still version of the live perception halo. Every point comes from
 * `poseTrace`, so the graphic is the recognition rather than a decoration
 * standing in for one. When a capture carries no trace, nothing is drawn — an
 * empty frame is honest, an invented constellation is not.
 *
 * Nothing is drawn on the face. `nose` positions the ring's head clearance and
 * is otherwise never marked or connected.
 */
function drawPerceptionHalo(
  context: CanvasRenderingContext2D,
  traces: PoseTrace[],
  width: number,
  portraitHeight: number,
  accent: string,
) {
  const rgb = hexToRgb(accent);
  const scale = width / 1200;

  traces.forEach((trace) => {
    const points = new Map(
      trace.keypoints
        .filter((keypoint) => keypoint.score >= 0.2)
        .map((keypoint) => [
          keypoint.name,
          { x: keypoint.x * width, y: keypoint.y * portraitHeight },
        ]),
    );
    if (points.size < 2) return;
    // Everything drawn on the body uses this set; the face is not in it.
    const bodyPoints = [...points.entries()]
      .filter(([name]) => name !== 'nose')
      .map(([, point]) => point);
    if (bodyPoints.length < 2) return;
    const emphasis = trace.isInitiator ? 1 : 0.72;

    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.shadowColor = `rgba(${rgb}, .9)`;

    const hull = headClearedHull(
      points,
      trace.hullPoints.map((point) => ({
        x: point.x * width,
        y: point.y * portraitHeight,
      })),
    );

    if (hull.length < 3) {
      context.restore();
      return;
    }

    // Three rings stepping outward. Nothing is drawn on the body itself:
    // joining thirteen points that already lie along the limbs reproduces a
    // skeleton no matter which pairs are chosen, so the presence is expressed
    // by distance from the body rather than by marks on it.
    [26, 52, 84].forEach((padding, ringIndex) => {
      const outline = expandHull(hull, padding * scale);
      context.strokeStyle = `rgba(${rgb}, ${
        (0.34 - ringIndex * 0.1) * emphasis
      })`;
      context.lineWidth = (1.7 - ringIndex * 0.4) * scale;
      context.setLineDash([3 * scale, 15 * scale]);
      context.shadowBlur = 6 * scale;
      strokeOutline(context, outline);
      context.setLineDash([]);

      if (ringIndex > 0) return;
      // Particles riding the innermost ring — this is what reads as "it sees me".
      context.fillStyle = `rgba(${rgb}, ${0.62 * emphasis})`;
      context.shadowBlur = 10 * scale;
      sampleOutline(outline, 17 * scale).forEach((point, index) => {
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          (index % 5 === 0 ? 2.8 : 1.5) * scale,
          0,
          Math.PI * 2,
        );
        context.fill();
      });
    });
    context.restore();
  });
}

/**
 * Draws the captured frame and everything that sits over it.
 *
 * The photo keeps the colour the camera saw. Only the strip the white labels
 * sit on is darkened, and it is darkened in neutral black — a full energy
 * colour wash was tried and dropped, because two hundred of them in four
 * different hues read as noise across a room.
 */
function drawPhotoLayer(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  photoHeight: number,
  portraitHeight: number,
  palette: { color: string; accent: string },
  poseTrace: PoseTrace[],
) {
  coverImage(context, image, sourceWidth, sourceHeight, 0, 0, width, photoHeight);

  const scrim = context.createLinearGradient(0, photoHeight * 0.55, 0, photoHeight);
  scrim.addColorStop(0, 'rgba(0,0,0,0)');
  scrim.addColorStop(1, 'rgba(6,10,14,0.78)');
  context.fillStyle = scrim;
  context.fillRect(0, 0, width, photoHeight);

  drawPerceptionHalo(context, poseTrace, width, portraitHeight, palette.accent);

  // The only colour left: a bar along the bottom edge of the photo.
  context.fillStyle = palette.accent;
  context.fillRect(0, photoHeight - 8, width, 8);
}

export async function renderFuturePortrait(
  capturedImage: string,
  primary: PrimaryEnergy,
  reading: BehaviorReading,
  narrativeCopy = SECONDARY_COPY[reading.secondary],
  poseTrace: PoseTrace[] = [],
): Promise<PortraitRecord> {
  const image = new Image();
  image.src = capturedImage;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  const photoHeight = Math.max(
    1,
    Math.round(canvas.width * (image.height / Math.max(1, image.width))),
  );
  const informationHeight = 490;
  canvas.height = photoHeight + informationHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  const config = ENERGY_CONFIG[primary];
  context.fillStyle = '#F3F5F6';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // The camera service already captured the exact object-fit: cover viewport.
  // Preserve that framing and its unmirrored orientation in the final image.
  drawPhotoLayer(
    context,
    image,
    image.width,
    image.height,
    canvas.width,
    photoHeight,
    canvas.height,
    config,
    poseTrace,
  );

  context.fillStyle = 'rgba(0,0,0,0.66)';
  context.fillRect(54, 54, 428, 58);
  context.fillStyle = '#FFFFFF';
  context.font = '600 22px Arial, sans-serif';
  context.fillText('BOSCH SUPPLIER CONFERENCE', 78, 91);

  context.font = '700 68px Arial, sans-serif';
  context.fillText(`${primary.toUpperCase()} ×`, 70, photoHeight - 200);
  context.fillText(reading.secondary.toUpperCase(), 70, photoHeight - 122);
  context.font = '400 26px Arial, sans-serif';
  context.fillText(
    `${reading.mode} · ${reading.peopleCount} signal${reading.peopleCount === 1 ? '' : 's'} observed`,
    74,
    photoHeight - 60,
  );

  context.fillStyle = '#FFFFFF';
  context.fillRect(0, photoHeight, canvas.width, informationHeight);
  context.fillStyle = config.color;
  context.fillRect(0, photoHeight, 18, informationHeight);
  context.fillStyle = '#101820';
  context.font = '700 32px Arial, sans-serif';
  context.fillText('YOUR FUTURE SIGNAL', 70, photoHeight + 82);

  context.font = '700 48px Arial, sans-serif';
  const copy = narrativeCopy;
  const words = copy.split(' ');
  let line = '';
  let y = photoHeight + 170;
  words.forEach((word) => {
    const test = `${line}${word} `;
    if (context.measureText(test).width > 1040 && line) {
      context.fillText(line.trim(), 70, y);
      line = `${word} `;
      y += 62;
    } else {
      line = test;
    }
  });
  context.fillText(line.trim(), 70, y);

  context.fillStyle = '#66737D';
  context.font = '400 24px Arial, sans-serif';
  context.fillText(
    'HUMAN INTENTION × OBSERVED BEHAVIOR → CO-CREATED FUTURE',
    70,
    canvas.height - 86,
  );
  context.fillStyle = '#101820';
  context.font = '700 30px Arial, sans-serif';
  context.fillText('AI FUTURE PORTRAITS', 844, canvas.height - 43);

  return {
    id: crypto.randomUUID(),
    imageData: canvas.toDataURL('image/jpeg', 0.88),
    timestamp: Date.now(),
    primary,
    secondary: reading.secondary,
    mode: reading.mode,
    narrative: copy,
    color: config.color,
    personCount: reading.peopleCount,
    poseTrace,
  };
}
