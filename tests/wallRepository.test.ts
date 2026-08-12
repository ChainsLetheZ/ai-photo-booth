import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wallConfig } from '../config/wallConfig';
import { WallRepository } from '../services/wallRepository';
import { WALL_MEDIA_ROUTE, wallMediaDirectory } from '../services/wallMedia';
import type { WallEntryDraft } from '../types';

function storedFile(directory: string, url: string) {
  return path.join(directory, url.slice(`${WALL_MEDIA_ROUTE}/`.length));
}

function draft(id: string): WallEntryDraft {
  return {
    id,
    imageUrl: 'data:image/jpeg;base64,AA==',
    sourceImageUrl: 'data:image/jpeg;base64,AQ==',
    primaryEnergy: 'Intelligence',
    secondaryDimension: 'Precision',
    narrativeLine: 'A precise collective signal.',
    personCount: 1,
    poseTrace: [],
    poseTraceVersion: 2,
  };
}

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-repository-test-'));
const storePath = path.join(tempDirectory, 'wall-entries.json');
const mediaDirectory = wallMediaDirectory(storePath);

try {
  const firstRepository = new WallRepository(storePath);
  const first = firstRepository.add(draft('first'));
  assert.equal(first.added, true);
  assert.equal(first.entry.shortCode, '101');

  // The photo is stored as a file and the entry keeps only its URL, so adding
  // a capture never rewrites the bytes of every earlier capture.
  assert.ok(first.entry.imageUrl.startsWith(`${WALL_MEDIA_ROUTE}/`));
  assert.ok(fs.existsSync(storedFile(mediaDirectory, first.entry.imageUrl)));
  assert.ok(first.entry.sourceImageUrl?.startsWith(`${WALL_MEDIA_ROUTE}/`));
  assert.ok(
    first.entry.sourceImageUrl &&
      fs.existsSync(storedFile(mediaDirectory, first.entry.sourceImageUrl)),
  );
  assert.ok(!fs.readFileSync(storePath, 'utf8').includes('data:image'));

  const duplicate = firstRepository.add(draft('first'));
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.entry.shortCode, '101');

  const unusedReservation = firstRepository.reserve('not-added');
  assert.equal(unusedReservation, '102');

  const restartedRepository = new WallRepository(storePath);
  const second = restartedRepository.add(draft('second'));
  assert.equal(second.entry.shortCode, '103');
  assert.deepEqual(
    restartedRepository.list().map((entry) => entry.shortCode),
    ['101', '103'],
  );

  assert.equal(
    wallConfig.layout.columns * wallConfig.layout.rows,
    wallConfig.capacity,
  );
  assert.ok(wallConfig.layout.cellWidthPx >= 105);
  const columnPitch =
    wallConfig.layout.cellWidthPx * 0.75 + wallConfig.layout.cellGapPx;
  const columnOffset =
    (wallConfig.layout.cellHeightPx + wallConfig.layout.cellGapPx) / 2;
  const layoutWidth =
    (wallConfig.layout.columns - 1) * columnPitch +
    wallConfig.layout.cellWidthPx;
  const layoutHeight =
    wallConfig.layout.rows *
      (wallConfig.layout.cellHeightPx + wallConfig.layout.cellGapPx) -
    wallConfig.layout.cellGapPx +
    columnOffset;
  assert.ok(layoutWidth <= wallConfig.layout.referenceWidthPx);
  assert.ok(
    layoutHeight <= wallConfig.layout.referenceHeightPx - 78 - 80,
    `Expected about 40px vertical margin, got layout height ${layoutHeight}`,
  );

  // Ids come from the browser, so one that looks like a path must not be able
  // to write outside the media folder.
  const traversalPath = path.join(tempDirectory, 'traversal', 'wall-entries.json');
  const traversalMedia = wallMediaDirectory(traversalPath);
  const traversalEntry = new WallRepository(traversalPath).add(
    draft('../../escape'),
  ).entry;
  assert.ok(traversalEntry.imageUrl.startsWith(`${WALL_MEDIA_ROUTE}/`));
  assert.equal(
    path.dirname(path.resolve(storedFile(traversalMedia, traversalEntry.imageUrl))),
    path.resolve(traversalMedia),
  );

  // A version 2 store holds inline base64 under the old two-field shape. It
  // must come back as one entry with one image file and no inline bytes.
  const { imageUrl, ...legacyRest } = draft('legacy');
  const legacyPath = path.join(tempDirectory, 'legacy', 'wall-entries.json');
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(
    legacyPath,
    JSON.stringify({
      version: 2,
      nextShortCode: 102,
      entries: [
        {
          ...legacyRest,
          photoUrl: imageUrl,
          thumbUrl: imageUrl,
          shortCode: '101',
          createdAt: 1,
        },
      ],
      reservations: { legacy: '101' },
    }),
    'utf8',
  );
  const migrated = new WallRepository(legacyPath).list();
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].shortCode, '101');
  assert.ok(migrated[0].imageUrl.startsWith(`${WALL_MEDIA_ROUTE}/`));
  assert.ok(
    fs.existsSync(storedFile(wallMediaDirectory(legacyPath), migrated[0].imageUrl)),
  );
  const legacyText = fs.readFileSync(legacyPath, 'utf8');
  assert.ok(!legacyText.includes('data:image'));
  assert.ok(!legacyText.includes('thumbUrl') && !legacyText.includes('photoUrl'));
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('Wall repository and fixed layout tests passed.');
