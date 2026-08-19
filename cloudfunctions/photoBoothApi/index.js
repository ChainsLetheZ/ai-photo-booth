const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const photos = db.collection('PhotoBoothPhotos');
const MAX_IMAGE_LENGTH = 4_000_000;

function response(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Photo-Booth-Token',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      ...extraHeaders,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function requestBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function requestPath(event) {
  return (
    event.path ||
    event.rawPath ||
    event.requestContext?.path ||
    event.requestContext?.http?.path ||
    '/'
  ).replace(/\/+$/, '');
}

function requestMethod(event) {
  return event.httpMethod || event.requestContext?.http?.method || 'GET';
}

function requestHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : '';
}

function authorized(event) {
  const expected = process.env.PHOTO_BOOTH_UPLOAD_TOKEN;
  return Boolean(expected) && requestHeader(event, 'X-Photo-Booth-Token') === expected;
}

function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_LENGTH) return null;
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  const extension = match[1].toLowerCase().replace('jpeg', 'jpg').replace('image/', '');
  return { extension, buffer: Buffer.from(match[2], 'base64') };
}

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function temporaryUrls(records, includeClaimToken = false) {
  const fileIds = [...new Set(records.flatMap((item) => [item.imageFileId, item.sourceImageFileId]).filter(Boolean))];
  if (!fileIds.length) return records;
  // CloudBase rejects getTempFileURL requests containing more than 50 files.
  // A wall can contain up to 200 records and two images per record, so resolve
  // the links in bounded batches instead of failing the entire entries feed.
  const urls = new Map();
  for (let offset = 0; offset < fileIds.length; offset += 50) {
    const result = await app.getTempFileURL({ fileList: fileIds.slice(offset, offset + 50) });
    for (const item of result.fileList || []) {
      if (item.fileID && item.tempFileURL) urls.set(item.fileID, item.tempFileURL);
    }
  }
  return records.map((item) => ({
    id: item._id,
    shortCode: item.shortCode,
    ...(includeClaimToken ? { claimToken: item.claimToken } : {}),
    createdAt: item.createdAt,
    imageUrl: urls.get(item.imageFileId),
    sourceImageUrl: item.sourceImageFileId ? urls.get(item.sourceImageFileId) : undefined,
    primaryEnergy: item.primaryEnergy,
    secondaryDimension: item.secondaryDimension,
    narrativeLine: item.narrativeLine,
    personCount: item.personCount,
    poseTrace: item.poseTrace || [],
    poseTraceVersion: 2,
  }));
}

async function reserveCode(body) {
  if (typeof body.id !== 'string' || !body.id) return response(400, { error: 'Invalid id' });
  try {
    const existing = await photos.doc(body.id).get();
    if (existing.data?.[0]?.shortCode) return response(200, { shortCode: existing.data[0].shortCode });
  } catch {}
  const latest = await photos.orderBy('shortCode', 'desc').limit(1).get();
  const last = Number(latest.data?.[0]?.shortCode || 100);
  const shortCode = String(Math.max(101, last + 1)).padStart(3, '0');
  const claimToken = crypto.randomBytes(18).toString('base64url');
  await photos.doc(body.id).set({
    shortCode,
    claimToken,
    status: 'reserved',
    createdAt: Date.now(),
  });
  return response(200, { shortCode });
}

async function createUploads(body) {
  if (typeof body.id !== 'string' || !Array.isArray(body.files)) {
    return response(400, { error: 'Invalid upload request' });
  }
  const current = await photos.doc(body.id).get();
  const reserved = current.data?.[0];
  if (!reserved?.shortCode || !reserved?.claimToken) {
    return response(409, { error: 'Code not reserved' });
  }
  const seen = new Set();
  const files = [];
  for (const item of body.files) {
    const variant = item?.variant;
    const extension = EXTENSION_BY_MIME[item?.mimeType];
    if (!['portrait', 'source'].includes(variant) || !extension || seen.has(variant)) {
      return response(400, { error: 'Invalid upload file' });
    }
    seen.add(variant);
    const cloudPath = `photo-booth/${new Date().toISOString().slice(0, 10)}/${body.id}/${variant}.${extension}`;
    const metadata = await app.getUploadMetadata({ cloudPath });
    files.push({ variant, cloudPath, ...metadata.data });
  }
  if (!seen.has('portrait') && !seen.has('source')) {
    return response(400, { error: 'At least one upload is required' });
  }
  if (!seen.has('portrait') && reserved.status !== 'ready') {
    return response(409, { error: 'Portrait must be ready before queued wall upload' });
  }
  const pending = Object.fromEntries(
    files.map((item) => [
      item.variant === 'portrait' ? 'pendingImageFileId' : 'pendingSourceImageFileId',
      item.fileId,
    ]),
  );
  const { _id, ...stored } = reserved;
  await photos.doc(body.id).set({ ...stored, ...pending, uploadIssuedAt: Date.now() });
  return response(200, files);
}

async function attachSource(body) {
  if (typeof body.id !== 'string' || typeof body.sourceImageFileId !== 'string') {
    return response(400, { error: 'Invalid wall source' });
  }
  const current = await photos.doc(body.id).get();
  const record = current.data?.[0];
  if (!record || record.status !== 'ready') return response(409, { error: 'Portrait is not ready' });
  if (body.sourceImageFileId !== record.pendingSourceImageFileId) {
    return response(409, { error: 'Wall upload does not match reservation' });
  }
  const { _id, pendingSourceImageFileId, ...stored } = record;
  const updated = { ...stored, sourceImageFileId: body.sourceImageFileId, wallReadyAt: Date.now() };
  await photos.doc(body.id).set(updated);
  return response(200, (await temporaryUrls([{ _id: body.id, ...updated }], true))[0]);
}

async function addEntry(body) {
  const directUpload = typeof body.imageFileId === 'string';
  const image = directUpload ? null : decodeImage(body.imageUrl);
  const source = directUpload || !body.sourceImageUrl ? null : decodeImage(body.sourceImageUrl);
  if (
    typeof body.id !== 'string' ||
    (!directUpload && (!image || (body.sourceImageUrl && !source)))
  ) {
    return response(400, { error: 'Invalid wall entry' });
  }
  const current = await photos.doc(body.id).get();
  const reserved = current.data?.[0];
  if (!reserved?.shortCode || !reserved?.claimToken) return response(409, { error: 'Code not reserved' });
  let imageFileId = body.imageFileId;
  let sourceFileId = body.sourceImageFileId;
  if (directUpload) {
    if (
      imageFileId !== reserved.pendingImageFileId ||
      (sourceFileId && sourceFileId !== reserved.pendingSourceImageFileId)
    ) {
      return response(409, { error: 'Upload does not match reservation' });
    }
  } else {
    const prefix = `photo-booth/${new Date().toISOString().slice(0, 10)}/${body.id}`;
    const uploaded = await app.uploadFile({
      cloudPath: `${prefix}/portrait.${image.extension}`,
      fileContent: image.buffer,
    });
    imageFileId = uploaded.fileID;
    if (source) {
      const uploadedSource = await app.uploadFile({
        cloudPath: `${prefix}/original.${source.extension}`,
        fileContent: source.buffer,
      });
      sourceFileId = uploadedSource.fileID;
    }
  }
  const {
    _id: reservedId,
    pendingImageFileId,
    pendingSourceImageFileId,
    uploadIssuedAt,
    ...reservedFields
  } = reserved;
  const record = {
    ...reservedFields,
    status: 'ready',
    imageFileId,
    sourceImageFileId: sourceFileId,
    primaryEnergy: body.primaryEnergy,
    secondaryDimension: body.secondaryDimension,
    narrativeLine: body.narrativeLine || '',
    personCount: Number(body.personCount) || 1,
    poseTrace: Array.isArray(body.poseTrace) ? body.poseTrace : [],
    poseTraceVersion: 2,
    readyAt: Date.now(),
  };
  await photos.doc(body.id).set(record);
  return response(201, (await temporaryUrls([{ _id: body.id, ...record }], true))[0]);
}

async function listEntries() {
  const result = await photos.orderBy('createdAt', 'asc').limit(200).get();
  return response(200, await temporaryUrls(result.data.filter((item) => item.status === 'ready')));
}

async function getPhoto(token, download) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return response(400, { error: 'Invalid token' });
  const result = await photos.where({ claimToken: token }).limit(1).get();
  if (!result.data.length || result.data[0].status !== 'ready') {
    return response(404, { error: 'Photo not found' });
  }
  const entry = (await temporaryUrls(result.data, true))[0];
  if (download) return response(302, '', { Location: entry.imageUrl });
  return response(200, entry);
}

exports.main = async (event) => {
  const method = requestMethod(event);
  const path = requestPath(event);
  if (method === 'OPTIONS') return response(204, '');
  try {
    if (method === 'GET' && path.endsWith('/entries')) return await listEntries();
    const downloadMatch = path.match(/\/([A-Za-z0-9_-]{24,64})\/download$/);
    if (method === 'GET' && downloadMatch) return await getPhoto(downloadMatch[1], true);
    const photoMatch = path.match(/\/([A-Za-z0-9_-]{24,64})$/);
    if (method === 'GET' && photoMatch) return await getPhoto(photoMatch[1], false);
    if (method === 'POST' && !authorized(event)) return response(401, { error: 'Unauthorized' });
    if (method === 'POST' && path.endsWith('/codes')) return await reserveCode(requestBody(event));
    if (method === 'POST' && path.endsWith('/uploads')) return await createUploads(requestBody(event));
    if (method === 'POST' && path.endsWith('/source')) return await attachSource(requestBody(event));
    if (method === 'POST' && path.endsWith('/entries')) return await addEntry(requestBody(event));
    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return response(500, {
      error: 'Photo service failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
