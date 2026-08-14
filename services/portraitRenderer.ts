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

// Coordinates are in the designer-supplied 1377 × 1835 artwork. This is the
// white inner frame: the two robots and illuminated border deliberately sit on
// top of the guest photo.
const PAPER_SIZE = { width: 1377, height: 1835 };
const PHOTO_WINDOW = { x: 151, y: 196, width: 1085, height: 1188, radius: 38 };
// The artwork is composed at its native size, then exported at a phone-friendly
// resolution. This cuts the corporate-network upload substantially without
// changing the on-screen composition or the downloaded aspect ratio.
const PORTRAIT_EXPORT = { width: 1033, height: 1376, quality: 0.72 };
const WALL_EXPORT = { width: 760, height: 832, quality: 0.68 };

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

/**
 * The artwork was supplied with a white placeholder rather than a transparent
 * cut-out. Clear only its near-white pixels inside the photo window so its
 * coloured border and both robot illustrations remain above the captured photo.
 */
function createPaperOverlay(template: HTMLImageElement) {
  const overlay = document.createElement('canvas');
  overlay.width = PAPER_SIZE.width;
  overlay.height = PAPER_SIZE.height;
  const context = overlay.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  context.drawImage(template, 0, 0, overlay.width, overlay.height);
  const pixels = context.getImageData(
    PHOTO_WINDOW.x,
    PHOTO_WINDOW.y,
    PHOTO_WINDOW.width,
    PHOTO_WINDOW.height,
  );
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset];
    const green = pixels.data[offset + 1];
    const blue = pixels.data[offset + 2];
    if (red >= 245 && green >= 245 && blue >= 245) pixels.data[offset + 3] = 0;
  }
  context.putImageData(pixels, PHOTO_WINDOW.x, PHOTO_WINDOW.y);
  return overlay;
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

  // Then restore every non-placeholder part of the supplied paper over it.
  context.drawImage(createPaperOverlay(paperTemplate), 0, 0);

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
    poseTrace,
  };
}
