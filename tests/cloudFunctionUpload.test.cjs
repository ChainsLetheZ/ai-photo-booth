const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const records = new Map();
const tempUrlBatchSizes = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const collection = {
  doc(id) {
    return {
      async get() {
        const value = records.get(id);
        return { data: value ? [{ _id: id, ...clone(value) }] : [] };
      },
      async set(value) {
        records.set(id, clone(value));
      },
    };
  },
  orderBy(field, direction = 'asc') {
    return {
      limit(count) {
        return {
          async get() {
            const multiplier = direction === 'desc' ? -1 : 1;
            const data = [...records.entries()]
              .map(([id, value]) => ({ _id: id, ...clone(value) }))
              .sort((left, right) => {
                const leftValue = left[field] ?? '';
                const rightValue = right[field] ?? '';
                return String(leftValue).localeCompare(String(rightValue)) * multiplier;
              })
              .slice(0, count);
            return { data };
          },
        };
      },
    };
  },
  where() {
    return {
      limit() {
        return { async get() { return { data: [] }; } };
      },
    };
  },
};

const app = {
  database() {
    return { collection: () => collection };
  },
  async getUploadMetadata({ cloudPath }) {
    return {
      data: {
        url: `https://upload.invalid/${cloudPath}`,
        token: 'temporary-token',
        authorization: 'temporary-authorization',
        fileId: `cloud://test-env/${cloudPath}`,
        cosFileId: `cos://${cloudPath}`,
      },
    };
  },
  async getTempFileURL({ fileList }) {
    assert.ok(fileList.length <= 50, `CloudBase temporary URL batch exceeded 50 files: ${fileList.length}`);
    tempUrlBatchSizes.push(fileList.length);
    return {
      fileList: fileList.map((fileID) => ({
        fileID,
        tempFileURL: `https://download.invalid/${encodeURIComponent(fileID)}`,
      })),
    };
  },
};

const originalLoad = Module._load;
Module._load = function mockCloudBase(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return { SYMBOL_CURRENT_ENV: 'test-env', init: () => app };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.PHOTO_BOOTH_UPLOAD_TOKEN = 'test-secret';
const functionPath = path.resolve(__dirname, '../cloudfunctions/photoBoothApi/index.js');
const { main } = require(functionPath);
Module._load = originalLoad;

function event(pathname, body) {
  return {
    path: pathname,
    httpMethod: 'POST',
    headers: { 'X-Photo-Booth-Token': 'test-secret' },
    body: JSON.stringify(body),
  };
}

(async () => {
  const id = 'test-portrait-id';
  const reserved = await main(event('/photo-booth/codes', { id }));
  assert.equal(reserved.statusCode, 200);

  const issued = await main(event('/photo-booth/uploads', {
    id,
    files: [{ variant: 'portrait', mimeType: 'image/jpeg' }],
  }));
  assert.equal(issued.statusCode, 200);
  const uploads = JSON.parse(issued.body);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].cloudPath, /\/portrait\.jpg$/);

  const finalized = await main(event('/photo-booth/entries', {
    id,
    imageFileId: uploads[0].fileId,
    primaryEnergy: 'Intelligence',
    secondaryDimension: 'Precision',
    narrativeLine: 'Test portrait',
    personCount: 1,
    poseTrace: [],
    poseTraceVersion: 2,
  }));
  assert.equal(finalized.statusCode, 201);
  const result = JSON.parse(finalized.body);
  assert.equal(result.id, id);
  assert.match(result.imageUrl, /^https:\/\/download\.invalid\//);
  assert.equal(records.get(id).status, 'ready');
  assert.equal(records.get(id).pendingImageFileId, undefined);
  assert.equal(records.get(id).pendingSourceImageFileId, undefined);

  // The clean wall photo is deliberately issued and attached only after the
  // downloadable portrait has reached ready state.
  const queued = await main(event('/photo-booth/uploads', {
    id,
    files: [{ variant: 'source', mimeType: 'image/jpeg' }],
  }));
  assert.equal(queued.statusCode, 200);
  const wallUploads = JSON.parse(queued.body);
  assert.equal(wallUploads.length, 1);
  assert.match(wallUploads[0].cloudPath, /\/source\.jpg$/);

  const attached = await main(event('/photo-booth/source', {
    id,
    sourceImageFileId: wallUploads[0].fileId,
  }));
  assert.equal(attached.statusCode, 200);
  const wallResult = JSON.parse(attached.body);
  assert.match(wallResult.sourceImageUrl, /^https:\/\/download\.invalid\//);
  assert.equal(records.get(id).sourceImageFileId, wallUploads[0].fileId);
  assert.equal(records.get(id).pendingSourceImageFileId, undefined);

  // Regression: the wall feed may resolve two files for each of 200 entries,
  // while CloudBase accepts at most 50 files per temporary-URL request.
  for (let index = 0; index < 30; index += 1) {
    records.set(`list-${index}`, {
      status: 'ready',
      createdAt: String(index + 2).padStart(4, '0'),
      imageFileId: `cloud://test-env/wall/list-${index}/portrait.jpg`,
      sourceImageFileId: `cloud://test-env/wall/list-${index}/source.jpg`,
      primaryEnergy: 'Intelligence',
      secondaryDimension: 'Precision',
      narrativeLine: `Wall portrait ${index}`,
      personCount: 1,
      poseTrace: [],
      poseTraceVersion: 2,
    });
  }

  tempUrlBatchSizes.length = 0;
  const listed = await main({
    path: '/photo-booth/entries',
    httpMethod: 'GET',
    headers: {},
  });
  assert.equal(listed.statusCode, 200);
  const listResult = JSON.parse(listed.body);
  assert.equal(listResult.length, 31);
  assert.deepEqual(tempUrlBatchSizes, [50, 12]);
  assert.ok(listResult.every((entry) => entry.imageUrl && entry.sourceImageUrl));

  console.log('CloudBase direct-upload contract tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
