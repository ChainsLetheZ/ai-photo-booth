import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Wall photos live next to the wall store as ordinary image files, and the
 * store keeps only these URLs. Keeping the bytes out of the JSON is what makes
 * a capture cost one small write instead of a full rewrite of every photo
 * taken so far.
 */
export const WALL_MEDIA_ROUTE = '/media/wall';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DATA_URL_PATTERN = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

export interface DecodedImage {
  buffer: Buffer;
  extension: string;
}

export function wallMediaDirectory(storeFilePath: string) {
  return path.join(path.dirname(storeFilePath), 'photos');
}

export function isDataUrl(value: string) {
  return value.startsWith('data:image/');
}

export function isWallMediaUrl(value: string) {
  return value.startsWith(`${WALL_MEDIA_ROUTE}/`);
}

export function decodeDataUrl(value: string): DecodedImage | null {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return null;
  const extension = EXTENSION_BY_MIME[match[1].toLowerCase()];
  if (!extension) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return null;
  return { buffer, extension };
}

/**
 * Entry ids arrive from the browser, so they are never used as a path segment
 * directly. The readable part is stripped to a safe alphabet and a digest of
 * the original id is appended, so two ids that strip to the same text still
 * get separate files.
 */
export function mediaBaseName(id: string) {
  const readable = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const digest = crypto.createHash('sha1').update(id).digest('hex').slice(0, 8);
  return `${readable || 'entry'}-${digest}`;
}

/**
 * Writes one image and returns the URL the wall loads it from. File names are
 * derived from the entry id and an entry is never rewritten, so the browser
 * can cache these forever — that is what keeps a wall reconnect cheap.
 */
export function writeWallImage(
  mediaDirectory: string,
  fileBaseName: string,
  image: DecodedImage,
): string {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const fileName = `${fileBaseName}.${image.extension}`;
  const temporaryPath = path.join(mediaDirectory, `${fileName}.tmp`);
  fs.writeFileSync(temporaryPath, image.buffer);
  fs.renameSync(temporaryPath, path.join(mediaDirectory, fileName));
  return `${WALL_MEDIA_ROUTE}/${fileName}`;
}
