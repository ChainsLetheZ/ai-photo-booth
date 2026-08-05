export interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoundsLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RoiSourceRect {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
}

export interface VideoViewportMapping {
  cover: CoverRect;
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
  point(x: number, y: number): Point;
  videoPoint(x: number, y: number): Point;
  captureBoundary(): { x: number; y: number; width: number; height: number };
}

/** Maps a detector point in the cropped ROI input back to source-video pixels. */
export function roiToVideo(
  x: number,
  y: number,
  roi: RoiSourceRect,
): Point {
  return {
    x: roi.sourceX + (x / Math.max(1, roi.inputWidth)) * roi.sourceWidth,
    y: roi.sourceY + (y / Math.max(1, roi.inputHeight)) * roi.sourceHeight,
  };
}

/** Calculates the exact source-video area visible through object-fit: cover. */
export function getCoverSourceRect(
  videoW: number,
  videoH: number,
  displayW: number,
  displayH: number,
): CoverRect {
  const sourceW = Math.max(1, videoW);
  const sourceH = Math.max(1, videoH);
  const targetW = Math.max(1, displayW);
  const targetH = Math.max(1, displayH);
  const scale = Math.max(targetW / sourceW, targetH / sourceH);
  const sw = targetW / scale;
  const sh = targetH / scale;
  return {
    sx: (sourceW - sw) / 2,
    sy: (sourceH - sh) / 2,
    sw,
    sh,
  };
}

/** Maps source-video pixel coordinates to CSS screen coordinates. */
export function videoToScreen(
  x: number,
  y: number,
  rect: CoverRect,
  displayW: number,
  displayH: number,
  mirrored: boolean,
): Point {
  const normalizedX = (x - rect.sx) / Math.max(1, rect.sw);
  const screenX = normalizedX * Math.max(1, displayW);
  return {
    x: mirrored ? Math.max(1, displayW) - screenX : screenX,
    y: ((y - rect.sy) / Math.max(1, rect.sh)) * Math.max(1, displayH),
  };
}

/** Maps CSS screen coordinates back to source-video pixel coordinates. */
export function screenToVideo(
  x: number,
  y: number,
  rect: CoverRect,
  displayW: number,
  displayH: number,
  mirrored: boolean,
): Point {
  const width = Math.max(1, displayW);
  const height = Math.max(1, displayH);
  const unmirroredX = mirrored ? width - x : x;
  return {
    x: rect.sx + (unmirroredX / width) * rect.sw,
    y: rect.sy + (y / height) * rect.sh,
  };
}

/**
 * Creates the only DOM-aware video→overlay mapping used by booth canvases.
 * Coordinates returned by point/videoPoint are CSS pixels in targetBounds.
 */
export function createVideoViewportMapping(
  video: HTMLVideoElement,
  targetBounds: BoundsLike,
  mirrored: boolean,
): VideoViewportMapping {
  const videoBounds = video.getBoundingClientRect();
  const displayWidth = Math.max(1, videoBounds.width);
  const displayHeight = Math.max(1, videoBounds.height);
  const videoWidth = Math.max(1, video.videoWidth || displayWidth);
  const videoHeight = Math.max(1, video.videoHeight || displayHeight);
  const cover = getCoverSourceRect(
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight,
  );
  const offsetX = videoBounds.left - targetBounds.left;
  const offsetY = videoBounds.top - targetBounds.top;
  const videoPoint = (x: number, y: number) => {
    const screen = videoToScreen(
      x,
      y,
      cover,
      displayWidth,
      displayHeight,
      mirrored,
    );
    return { x: offsetX + screen.x, y: offsetY + screen.y };
  };

  return {
    cover,
    videoWidth,
    videoHeight,
    displayWidth,
    displayHeight,
    point(x: number, y: number) {
      return videoPoint(x * videoWidth, y * videoHeight);
    },
    videoPoint,
    captureBoundary() {
      const first = videoPoint(cover.sx, cover.sy);
      const second = videoPoint(cover.sx + cover.sw, cover.sy + cover.sh);
      return {
        x: Math.min(first.x, second.x),
        y: Math.min(first.y, second.y),
        width: Math.abs(second.x - first.x),
        height: Math.abs(second.y - first.y),
      };
    },
  };
}
