import assert from 'node:assert/strict';
import {
  getCoverSourceRect,
  roiToVideo,
  screenToVideo,
  videoToScreen,
} from '../utils/viewportTransform';

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

const landscape = getCoverSourceRect(1440, 1080, 1920, 1080);
close(landscape.sx, 0);
close(landscape.sy, 135);
close(landscape.sw, 1440);
close(landscape.sh, 810);

const portrait = getCoverSourceRect(1920, 1080, 900, 1600);
close(portrait.sy, 0);
close(portrait.sh, 1080);
close(portrait.sw, 607.5);
close(portrait.sx, 656.25);

const source = { x: 300, y: 500 };
const screen = videoToScreen(
  source.x,
  source.y,
  landscape,
  1920,
  1080,
  false,
);
const roundTrip = screenToVideo(
  screen.x,
  screen.y,
  landscape,
  1920,
  1080,
  false,
);
close(roundTrip.x, source.x);
close(roundTrip.y, source.y);

const mirrored = videoToScreen(
  source.x,
  source.y,
  landscape,
  1920,
  1080,
  true,
);
close(mirrored.x, 1920 - screen.x);
const mirroredRoundTrip = screenToVideo(
  mirrored.x,
  mirrored.y,
  landscape,
  1920,
  1080,
  true,
);
close(mirroredRoundTrip.x, source.x);
close(mirroredRoundTrip.y, source.y);

const visibleTopLeft = videoToScreen(
  landscape.sx,
  landscape.sy,
  landscape,
  1920,
  1080,
  false,
);
close(visibleTopLeft.x, 0);
close(visibleTopLeft.y, 0);
const visibleBottomRight = videoToScreen(
  landscape.sx + landscape.sw,
  landscape.sy + landscape.sh,
  landscape,
  1920,
  1080,
  false,
);
close(visibleBottomRight.x, 1920);
close(visibleBottomRight.y, 1080);

const roiMapped = roiToVideo(128, 64, {
  sourceX: 120,
  sourceY: 40,
  sourceWidth: 960,
  sourceHeight: 720,
  inputWidth: 256,
  inputHeight: 256,
});
close(roiMapped.x, 600);
close(roiMapped.y, 220);

console.log('Viewport transform tests passed.');
