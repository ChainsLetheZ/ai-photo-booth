import { SECONDARY_COPY } from '../constants';
import type {
  BehaviorReading,
  PortraitRecord,
  PoseTrace,
  PrimaryEnergy,
} from '../types';
import { getCoverSourceRect } from '../utils/viewportTransform';

/** The supplied Bosch Supplier Day Gala paper, kept as a public print asset. */
const PAPER_TEMPLATE_URL = '/templates/bosch-supplier-day-gala-paper.png';

// Coordinates are measured from the newly supplied 3596 × 4798 artwork. The
// bright gold-blue frame and the lower-right robot should remain on top of the
// guest photo, so only the central opening is filled here.
const PAPER_SIZE = { width: 3596, height: 4798 };
const PHOTO_WINDOW = { x: 393, y: 504, width: 2813, height: 3094, radius: 102 };
const PAPER_KEYWORDS = [
  'ACCELERATE',
  'CONNECT',
  'COLLABORATE',
  'MOMENTUM',
  'PRECISION',
  'EXPLORE',
  'INNOVATE',
  'TOGETHER',
] as const;
// QR downloads use the full supplied paper artwork, preserving the print-ready
// composition. The separate wall source remains compact because it never needs
// to be downloaded or printed.
const PORTRAIT_EXPORT = { width: PAPER_SIZE.width, height: PAPER_SIZE.height, quality: 0.84 };
const WALL_EXPORT = { width: 480, height: 525, quality: 0.58 };

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${source}`));
    image.src = source;
  });
}

function exportJpeg(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  quality: number,
) {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return output.toDataURL('image/jpeg', quality);
}

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
  const source = getCoverSourceRect(sourceWidth, sourceHeight, width, height);
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

function clipRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
  context.clip();
}

function pickPaperKeyword(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return PAPER_KEYWORDS[hash % PAPER_KEYWORDS.length];
}

function drawPaperKeyword(context: CanvasRenderingContext2D, keyword: string) {
  context.save();
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.shadowColor = 'rgba(0, 0, 0, 0.38)';
  context.shadowBlur = 24;
  context.shadowOffsetY = 10;

  const x = 180;
  const baselineY = 4040;
  const gradient = context.createLinearGradient(x, baselineY - 180, x + 1250, baselineY + 40);
  gradient.addColorStop(0, '#F6C66A');
  gradient.addColorStop(0.5, '#FFF4D5');
  gradient.addColorStop(1, '#8CC8FF');

  context.fillStyle = gradient;
  context.font = '700 156px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  context.letterSpacing = '6px';
  context.fillText(keyword, x, baselineY);

  context.shadowColor = 'transparent';
  context.fillStyle = 'rgba(255, 255, 255, 0.78)';
  context.font = '500 38px "Helvetica Neue", Arial, sans-serif';
  context.letterSpacing = '3px';
  context.fillText('BOSCH CHINA SUPPLIER DAY 2026', x + 6, baselineY + 72);
  context.restore();
}

export async function renderFuturePortrait(
  capturedImage: string,
  primary: PrimaryEnergy,
  reading: BehaviorReading,
  narrativeCopy = SECONDARY_COPY[reading.secondary],
  poseTrace: PoseTrace[] = [],
  id = crypto.randomUUID(),
): Promise<PortraitRecord> {
  const [image, paperTemplate] = await Promise.all([
    loadImage(capturedImage),
    loadImage(PAPER_TEMPLATE_URL),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = PAPER_SIZE.width;
  canvas.height = PAPER_SIZE.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  // Keep a compact, unframed version specifically for the photo wall. The QR
  // download continues to use the composed paper below.
  const cleanPhoto = document.createElement('canvas');
  cleanPhoto.width = PHOTO_WINDOW.width;
  cleanPhoto.height = PHOTO_WINDOW.height;
  const cleanContext = cleanPhoto.getContext('2d');
  if (!cleanContext) throw new Error('Canvas is unavailable');
  cleanContext.translate(cleanPhoto.width, 0);
  cleanContext.scale(-1, 1);
  coverImage(
    cleanContext,
    image,
    image.width,
    image.height,
    0,
    0,
    cleanPhoto.width,
    cleanPhoto.height,
  );

  // Fill the central blank space with the guest photo first.
  context.save();
  clipRoundedRect(
    context,
    PHOTO_WINDOW.x,
    PHOTO_WINDOW.y,
    PHOTO_WINDOW.width,
    PHOTO_WINDOW.height,
    PHOTO_WINDOW.radius,
  );
  context.drawImage(cleanPhoto, PHOTO_WINDOW.x, PHOTO_WINDOW.y);
  context.restore();

  // The new supplied paper already contains a transparent cut-out, so drawing
  // it last keeps the neon border and robot art above the photo automatically.
  context.drawImage(paperTemplate, 0, 0, PAPER_SIZE.width, PAPER_SIZE.height);
  const paperKeyword = pickPaperKeyword(id);
  drawPaperKeyword(context, paperKeyword);

  return {
    id,
    // The wall uses only this clean inner photo; the QR keeps the full paper.
    sourceImageData: exportJpeg(
      cleanPhoto,
      WALL_EXPORT.width,
      WALL_EXPORT.height,
      WALL_EXPORT.quality,
    ),
    imageData: exportJpeg(
      canvas,
      PORTRAIT_EXPORT.width,
      PORTRAIT_EXPORT.height,
      PORTRAIT_EXPORT.quality,
    ),
    timestamp: Date.now(),
    primary,
    secondary: reading.secondary,
    mode: reading.mode,
    narrative: narrativeCopy,
    color: '#0069B4',
    personCount: reading.peopleCount,
    paperKeyword,
    poseTrace,
  };
}
