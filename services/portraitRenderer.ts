import { ENERGY_CONFIG, SECONDARY_COPY } from '../constants';
import type { BehaviorReading, PortraitRecord, PrimaryEnergy } from '../types';

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
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
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
): Promise<PortraitRecord> {
  const image = new Image();
  image.src = capturedImage;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  const config = ENERGY_CONFIG[primary];
  context.fillStyle = '#F3F5F6';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  coverImage(context, image, image.width, image.height, 0, 0, canvas.width, 1110);
  context.restore();

  const shade = context.createLinearGradient(0, 250, 0, 1110);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.66, 'rgba(0,0,0,0.04)');
  shade.addColorStop(1, `${config.color}E8`);
  context.fillStyle = shade;
  context.fillRect(0, 0, canvas.width, 1110);

  const glow = context.createRadialGradient(600, 560, 40, 600, 560, 640);
  glow.addColorStop(0, `${config.accent}99`);
  glow.addColorStop(1, `${config.color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, 1110);
  drawNetwork(context, Date.now() % 97, config.accent, canvas.width, 1110);

  context.fillStyle = 'rgba(0,0,0,0.66)';
  context.fillRect(54, 54, 428, 58);
  context.fillStyle = '#FFFFFF';
  context.font = '600 22px Arial, sans-serif';
  context.fillText('BOSCH SUPPLIER CONFERENCE', 78, 91);

  context.font = '700 68px Arial, sans-serif';
  context.fillText(`${primary.toUpperCase()} ×`, 70, 910);
  context.fillText(reading.secondary.toUpperCase(), 70, 988);
  context.font = '400 26px Arial, sans-serif';
  context.fillText(
    `${reading.mode} · ${reading.peopleCount} signal${reading.peopleCount === 1 ? '' : 's'} observed`,
    74,
    1042,
  );

  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 1110, canvas.width, 490);
  context.fillStyle = config.color;
  context.fillRect(0, 1110, 18, 490);
  context.fillStyle = '#101820';
  context.font = '700 32px Arial, sans-serif';
  context.fillText('YOUR FUTURE SIGNAL', 70, 1192);

  context.font = '700 48px Arial, sans-serif';
  const copy = SECONDARY_COPY[reading.secondary];
  const words = copy.split(' ');
  let line = '';
  let y = 1280;
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
  context.fillText('HUMAN INTENTION × OBSERVED BEHAVIOR → CO-CREATED FUTURE', 70, 1514);
  context.fillStyle = '#101820';
  context.font = '700 30px Arial, sans-serif';
  context.fillText('AI FUTURE PORTRAITS', 844, 1557);

  return {
    id: crypto.randomUUID(),
    imageData: canvas.toDataURL('image/jpeg', 0.88),
    capturedImage,
    timestamp: Date.now(),
    primary,
    secondary: reading.secondary,
    mode: reading.mode,
    narrative: copy,
    color: config.color,
  };
}
