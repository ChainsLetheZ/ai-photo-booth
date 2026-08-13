const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const objects = new Map();

class MockOSS {
  async get(key) {
    if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
    return { content: Buffer.from(objects.get(key)) };
  }
  async put(key, value, options = {}) {
    if (options.headers?.['x-oss-forbid-overwrite'] === 'true' && objects.has(key)) {
      throw Object.assign(new Error('exists'), { status: 409, code: 'FileAlreadyExists' });
    }
    objects.set(key, Buffer.from(value));
    return { name: key };
  }
  async head(key) {
    if (!objects.has(key)) throw Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' });
    return { status: 200 };
  }
  async signatureUrlV4(method, _expires, request, key) {
    const query = new URLSearchParams({ method, ...request.queries }).toString();
    return `https://photo-booth.oss-cn-shanghai.aliyuncs.com/${key}?${query}`;
  }
}

const originalLoad = Module._load;
Module._load = function mockAliOss(request, parent, isMain) {
  if (request === 'ali-oss') return MockOSS;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.PHOTO_BOOTH_UPLOAD_TOKEN = 'test-secret';
process.env.PHOTO_BOOTH_OSS_REGION = 'oss-cn-shanghai';
process.env.PHOTO_BOOTH_OSS_BUCKET = 'photo-booth-test';
const { handler } = require(path.resolve(__dirname, '../functions/photoBoothApi/index.js'));
Module._load = originalLoad;

const context = {
  region: 'cn-shanghai',
  credentials: {
    accessKeyId: 'STS.test',
    accessKeySecret: 'secret',
    securityToken: 'token',
  },
};

function event(method, pathname, body, authorized = true) {
  return JSON.stringify({
    version: 'v1',
    rawPath: pathname,
    headers: authorized ? { 'X-Photo-Booth-Token': 'test-secret' } : {},
    body: body === undefined ? '' : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method, path: pathname } },
  });
}

(async () => {
  const id = 'test-portrait-id';
  const unauthorized = await handler(event('POST', '/codes', { id }, false), context);
  assert.equal(unauthorized.statusCode, 401);

  const reserved = await handler(event('POST', '/codes', { id }), context);
  assert.equal(reserved.statusCode, 200);
  assert.equal(JSON.parse(reserved.body).shortCode, '101');
  const repeated = await handler(event('POST', '/codes', { id }), context);
  assert.equal(JSON.parse(repeated.body).shortCode, '101');

  const issued = await handler(event('POST', '/uploads', {
    id,
    files: [
      { variant: 'portrait', mimeType: 'image/jpeg' },
      { variant: 'source', mimeType: 'image/png' },
    ],
  }), context);
  assert.equal(issued.statusCode, 200);
  const uploads = JSON.parse(issued.body);
  assert.equal(uploads.length, 2);
  assert.match(uploads[0].objectKey, /\/portrait\.jpg$/);
  assert.match(uploads[1].objectKey, /\/source\.png$/);
  assert.equal(uploads[0].headers['Content-Type'], 'image/jpeg');

  objects.set(uploads[0].objectKey, Buffer.from('portrait'));
  objects.set(uploads[1].objectKey, Buffer.from('source'));
  const finalized = await handler(event('POST', '/entries', {
    id,
    imageObjectKey: uploads[0].objectKey,
    sourceImageObjectKey: uploads[1].objectKey,
    primaryEnergy: 'Intelligence',
    secondaryDimension: 'Precision',
    narrativeLine: 'Test portrait',
    personCount: 1,
    poseTrace: [],
    poseTraceVersion: 2,
  }), context);
  assert.equal(finalized.statusCode, 201);
  const result = JSON.parse(finalized.body);
  assert.equal(result.id, id);
  assert.match(result.imageUrl, /^https:\/\/photo-booth\.oss-cn-shanghai\.aliyuncs\.com\//);
  assert.match(result.claimToken, /^[A-Za-z0-9_-]{24,64}$/);

  const listed = await handler(event('GET', '/entries'), context);
  assert.equal(JSON.parse(listed.body).length, 1);
  const fetched = await handler(event('GET', `/photos/${result.claimToken}`), context);
  assert.equal(JSON.parse(fetched.body).shortCode, '101');
  const downloaded = await handler(event('GET', `/photos/${result.claimToken}/download`), context);
  assert.equal(downloaded.statusCode, 302);
  assert.match(downloaded.headers.Location, /response-content-disposition/);

  console.log('Alibaba Cloud FC + OSS direct-upload contract tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
