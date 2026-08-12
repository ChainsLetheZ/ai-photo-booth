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

async function temporaryUrls(records, includeClaimToken = false) {
  const fileIds = [...new Set(records.flatMap((item) => [item.imageFileId, item.sourceImageFileId]).filter(Boolean))];
  if (!fileIds.length) return records;
  const result = await app.getTempFileURL({ fileList: fileIds });
  const urls = new Map(result.fileList.map((item) => [item.fileID, item.tempFileURL]));
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

async function addEntry(body) {
  const image = decodeImage(body.imageUrl);
  const source = body.sourceImageUrl ? decodeImage(body.sourceImageUrl) : null;
  if (!image || (body.sourceImageUrl && !source) || typeof body.id !== 'string') {
    return response(400, { error: 'Invalid wall entry' });
  }
  const current = await photos.doc(body.id).get();
  const reserved = current.data?.[0];
  if (!reserved?.shortCode || !reserved?.claimToken) return response(409, { error: 'Code not reserved' });
  const { _id: reservedId, ...reservedFields } = reserved;
  const prefix = `photo-booth/${new Date().toISOString().slice(0, 10)}/${body.id}`;
  const uploaded = await app.uploadFile({
    cloudPath: `${prefix}/portrait.${image.extension}`,
    fileContent: image.buffer,
  });
  let sourceFileId;
  if (source) {
    const uploadedSource = await app.uploadFile({
      cloudPath: `${prefix}/original.${source.extension}`,
      fileContent: source.buffer,
    });
    sourceFileId = uploadedSource.fileID;
  }
  const record = {
    ...reservedFields,
    status: 'ready',
    imageFileId: uploaded.fileID,
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
