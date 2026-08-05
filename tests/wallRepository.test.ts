import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wallConfig } from '../config/wallConfig';
import { WallRepository } from '../services/wallRepository';
import type { WallEntryDraft } from '../types';

function draft(id: string): WallEntryDraft {
  return {
    id,
    photoUrl: 'data:image/jpeg;base64,AA==',
    thumbUrl: 'data:image/webp;base64,AA==',
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

try {
  const firstRepository = new WallRepository(storePath);
  const first = firstRepository.add(draft('first'));
  assert.equal(first.added, true);
  assert.equal(first.entry.shortCode, '101');

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
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log('Wall repository and fixed layout tests passed.');
