import { ENERGY_CONFIG, SECONDARY_COPY } from '../constants';
import type {
  BehaviorReading,
  PortraitRecord,
  PoseTrace,
  PrimaryEnergy,
} from '../types';
import { getCoverSourceRect } from '../utils/viewportTransform';

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

function drawNetwork(
  context: CanvasRenderingContext2D,
  seed: number,
  color: string,
  width: number,
  height: number,
) {
  const points = Array.from({ length: 24 }, (_, index) => ({
    x: (((index * 197 + seed * 71) % 1000) / 1000) * width,
    y: (((index * 353 + seed * 113) % 1000) / 1000) * height,
  }));

  context.save();
  context.globalCompositeOperation = 'screen';
  context.strokeStyle = color;
  context.fillStyle = '#FFFFFF';
  context.lineWidth = 2;
  context.globalAlpha = 0.34;
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[(index + 7) % points.length];
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(next.x, next.y);
    context.stroke();
  }
  context.globalAlpha = 0.75;
  points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, index % 4 === 0 ? 5 : 2.5, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
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
  coverImage(
    context,
    image,
    image.width,
    image.height,
    0,
    0,
    canvas.width,
    photoHeight,
  );

  const shade = context.createLinearGradient(
    0,
    photoHeight * 0.22,
    0,
    photoHeight,
  );
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.66, 'rgba(0,0,0,0.04)');
  shade.addColorStop(1, `${config.color}E8`);
  context.fillStyle = shade;
  context.fillRect(0, 0, canvas.width, photoHeight);

  const glow = context.createRadialGradient(600, 560, 40, 600, 560, 640);
  glow.addColorStop(0, `${config.accent}99`);
  glow.addColorStop(1, `${config.color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, photoHeight);
  drawNetwork(context, Date.now() % 97, config.accent, canvas.width, photoHeight);

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
