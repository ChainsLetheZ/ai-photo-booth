'use strict';

const crypto = require('crypto');
const OSS = require('ali-oss');

const MAX_ENTRIES = 200;
const FIRST_SHORT_CODE = 101;
const LAST_SHORT_CODE = FIRST_SHORT_CODE + MAX_ENTRIES - 1;
const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const ALLOWED_PRIMARY = new Set(['Motion', 'Intelligence', 'Life', 'Impact']);
const ALLOWED_SECONDARY = new Set([
  'Collaboration',
  'Precision',
  'Momentum',
  'Exploration',
]);
const signedUrlCache = new Map();

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function prefix() {
  return env('PHOTO_BOOTH_OSS_PREFIX', 'photo-booth').replace(/^\/+|\/+$/g, '');
}

function objectKey(...parts) {
  return [prefix(), ...parts].filter(Boolean).join('/');
}

function response(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Photo-Booth-Token',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      ...extraHeaders,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function parseEvent(raw) {
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf8'));
  if (typeof raw === 'string') return JSON.parse(raw || '{}');
  return raw || {};
}

function requestBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function requestPath(event) {
  return (
    event.requestContext?.http?.path ||
    event.path ||
    event.rawPath ||
    '/'
  ).replace(/\/+$/, '') || '/';
}

function requestMethod(event) {
  return event.requestContext?.http?.method || event.httpMethod || 'GET';
}

function requestHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  return key ? headers[key] : '';
}

function authorized(event) {
  const expected = env('PHOTO_BOOTH_UPLOAD_TOKEN');
  return Boolean(expected) &&
    requestHeader(event, 'X-Photo-Booth-Token') === expected;
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isNotFound(error) {
  return error?.status === 404 || error?.code === 'NoSuchKey';
}

function isAlreadyExists(error) {
  return error?.status === 409 ||
    ['FileAlreadyExists', 'ObjectAlreadyExists'].includes(error?.code);
}

function clientFor(context = {}) {
  const credentials = context.credentials || {};
  const accessKeyId = credentials.accessKeyId || env('ALIBABA_CLOUD_ACCESS_KEY_ID');
  const accessKeySecret = credentials.accessKeySecret || env('ALIBABA_CLOUD_ACCESS_KEY_SECRET');
  const stsToken = credentials.securityToken || env('ALIBABA_CLOUD_SECURITY_TOKEN') || undefined;
  const region = env('PHOTO_BOOTH_OSS_REGION', context.region ? `oss-${context.region}` : '');
  const bucket = env('PHOTO_BOOTH_OSS_BUCKET');
  if (!accessKeyId || !accessKeySecret || !region || !bucket) {
    throw new Error('OSS credentials, region, or bucket are not configured');
  }
  return new OSS({
    accessKeyId,
    accessKeySecret,
    stsToken,
    region,
    bucket,
    authorizationV4: true,
  });
}

async function readJson(client, key, fallback) {
  try {
    const result = await client.get(key);
    return JSON.parse(Buffer.from(result.content).toString('utf8'));
  } catch (error) {
    if (isNotFound(error)) return fallback;
    throw error;
  }
}

async function putJson(client, key, value, forbidOverwrite = false) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...(forbidOverwrite ? { 'x-oss-forbid-overwrite': 'true' } : {}),
  };
  await client.put(key, Buffer.from(JSON.stringify(value)), { headers });
}

async function signedUrl(client, method, key, options = {}) {
  const expires = Number(options.expires || env('PHOTO_BOOTH_SIGNED_URL_TTL', '3600'));
  const request = {
    headers: options.headers || {},
    queries: options.queries || {},
  };
  if (method !== 'GET' || Object.keys(request.queries).length) {
    try {
      console.log(`[photo-booth] signing method=${method} key=${key} v4=${client.options?.authorizationV4 === true}`);
      const url = await client.signatureUrlV4(method, expires, request, key);
      console.log(`[photo-booth] signed method=${method} key=${key}`);
      return url;
    } catch (error) {
      console.log('[photo-booth] signing failed', JSON.stringify({
        name: error?.name,
        message: error?.message,
        code: error?.code,
        status: error?.status,
        stack: error?.stack,
      }));
      throw error;
    }
  }
  const cacheKey = `${key}:${Math.floor(Date.now() / 1_800_000)}`;
  if (!signedUrlCache.has(cacheKey)) {
    signedUrlCache.clear();
    signedUrlCache.set(
      cacheKey,
      await client.signatureUrlV4(method, expires, request, key),
    );
  }
  return signedUrlCache.get(cacheKey);
}

async function externalRecord(client, record, includeClaimToken = false) {
  return {
    id: record.id,
    shortCode: record.shortCode,
    ...(includeClaimToken ? { claimToken: record.claimToken } : {}),
    createdAt: record.createdAt,
    imageUrl: await signedUrl(client, 'GET', record.imageObjectKey),
    sourceImageUrl: record.sourceImageObjectKey
      ? await signedUrl(client, 'GET', record.sourceImageObjectKey)
      : undefined,
    primaryEnergy: record.primaryEnergy,
    secondaryDimension: record.secondaryDimension,
    narrativeLine: record.narrativeLine,
    personCount: record.personCount,
    poseTrace: record.poseTrace || [],
    poseTraceVersion: 2,
  };
}

async function reserveCode(client, body) {
  if (!validId(body.id)) return response(400, { error: 'Invalid id' });
  const reservationKey = objectKey('reservations', `${body.id}.json`);
  const existing = await readJson(client, reservationKey, null);
  if (existing?.shortCode) return response(200, { shortCode: existing.shortCode });

  const requested = /^\d{3}$/.test(body.requestedShortCode || '')
    ? Number(body.requestedShortCode)
    : null;
  const candidates = [];
  if (requested >= FIRST_SHORT_CODE && requested <= LAST_SHORT_CODE) {
    candidates.push(requested);
  }
  for (let code = FIRST_SHORT_CODE; code <= LAST_SHORT_CODE; code += 1) {
    if (code !== requested) candidates.push(code);
  }

  for (const code of candidates) {
    const shortCode = String(code).padStart(3, '0');
    const claimToken = crypto.randomBytes(18).toString('base64url');
    const reservation = {
      id: body.id,
      shortCode,
      claimToken,
      status: 'reserved',
      createdAt: Date.now(),
    };
    try {
      await putJson(client, objectKey('codes', `${shortCode}.json`), {
        id: body.id,
        createdAt: reservation.createdAt,
      }, true);
      await putJson(client, reservationKey, reservation, true);
      return response(200, { shortCode });
    } catch (error) {
      if (isAlreadyExists(error)) {
        const concurrent = await readJson(client, reservationKey, null);
        if (concurrent?.shortCode) {
          return response(200, { shortCode: concurrent.shortCode });
        }
        continue;
      }
      throw error;
    }
  }
  return response(409, { error: 'Wall capacity reached' });
}

async function createUploads(client, body) {
  if (!validId(body.id) || !Array.isArray(body.files)) {
    return response(400, { error: 'Invalid upload request' });
  }
  const reservationKey = objectKey('reservations', `${body.id}.json`);
  const reserved = await readJson(client, reservationKey, null);
  if (!reserved?.shortCode || !reserved?.claimToken) {
    return response(409, { error: 'Code not reserved' });
  }

  const seen = new Set();
  const files = [];
  for (const item of body.files) {
    const variant = item?.variant;
    const mimeType = item?.mimeType;
    const extension = EXTENSION_BY_MIME[mimeType];
    if (!['portrait', 'source'].includes(variant) || !extension || seen.has(variant)) {
      return response(400, { error: 'Invalid upload file' });
    }
    seen.add(variant);
    const key = objectKey(
      'images',
      new Date().toISOString().slice(0, 10),
      body.id,
      `${variant}.${extension}`,
    );
    const headers = {
      'Content-Type': mimeType,
    };
    files.push({
      variant,
      objectKey: key,
      url: await signedUrl(client, 'PUT', key, { expires: 300, headers }),
      headers,
    });
  }
  if (!seen.has('portrait')) {
    return response(400, { error: 'Portrait upload is required' });
  }

  await putJson(client, reservationKey, {
    ...reserved,
    pendingImageObjectKey: files.find((item) => item.variant === 'portrait').objectKey,
    pendingSourceImageObjectKey: files.find((item) => item.variant === 'source')?.objectKey,
    uploadIssuedAt: Date.now(),
  });
  return response(200, files);
}

function validEntry(body) {
  return validId(body.id) &&
    typeof body.imageObjectKey === 'string' &&
    (body.sourceImageObjectKey === undefined || typeof body.sourceImageObjectKey === 'string') &&
    ALLOWED_PRIMARY.has(body.primaryEnergy) &&
    ALLOWED_SECONDARY.has(body.secondaryDimension) &&
    typeof body.narrativeLine === 'string' &&
    Number.isInteger(body.personCount) && body.personCount >= 1 && body.personCount <= 5 &&
    Array.isArray(body.poseTrace) && body.poseTraceVersion === 2;
}

async function addEntry(client, body) {
  if (!validEntry(body)) return response(400, { error: 'Invalid wall entry' });
  const reservationKey = objectKey('reservations', `${body.id}.json`);
  const reserved = await readJson(client, reservationKey, null);
  if (!reserved?.shortCode || !reserved?.claimToken) {
    return response(409, { error: 'Code not reserved' });
  }
  if (
    body.imageObjectKey !== reserved.pendingImageObjectKey ||
    (body.sourceImageObjectKey || undefined) !==
      (reserved.pendingSourceImageObjectKey || undefined)
  ) {
    return response(409, { error: 'Upload does not match reservation' });
  }
  try {
    await client.head(body.imageObjectKey);
    if (body.sourceImageObjectKey) await client.head(body.sourceImageObjectKey);
  } catch (error) {
    if (isNotFound(error)) return response(409, { error: 'Upload is incomplete' });
    throw error;
  }

  const record = {
    id: body.id,
    shortCode: reserved.shortCode,
    claimToken: reserved.claimToken,
    createdAt: reserved.createdAt,
    status: 'ready',
    imageObjectKey: body.imageObjectKey,
    sourceImageObjectKey: body.sourceImageObjectKey,
    primaryEnergy: body.primaryEnergy,
    secondaryDimension: body.secondaryDimension,
    narrativeLine: body.narrativeLine,
    personCount: body.personCount,
    poseTrace: body.poseTrace,
    poseTraceVersion: 2,
    readyAt: Date.now(),
  };

  const indexKey = objectKey('index', 'entries.json');
  const records = await readJson(client, indexKey, []);
  const updated = [
    ...records.filter((item) => item.id !== record.id),
    record,
  ].sort((left, right) => left.createdAt - right.createdAt).slice(-MAX_ENTRIES);
  await putJson(client, objectKey('claims', `${record.claimToken}.json`), record);
  await putJson(client, indexKey, updated);
  await putJson(client, reservationKey, record);
  return response(201, await externalRecord(client, record, true));
}

async function listEntries(client) {
  const records = await readJson(client, objectKey('index', 'entries.json'), []);
  return response(200, await Promise.all(records.map((item) => externalRecord(client, item))));
}

async function getPhoto(client, token, download) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) {
    return response(400, { error: 'Invalid token' });
  }
  const record = await readJson(client, objectKey('claims', `${token}.json`), null);
  if (!record || record.status !== 'ready') {
    return response(404, { error: 'Photo not found' });
  }
  if (download) {
    const extension = record.imageObjectKey.split('.').pop() || 'jpg';
    const disposition = `attachment; filename="Bosch-Supplier-Day-${record.shortCode}.${extension}"`;
    const location = await signedUrl(client, 'GET', record.imageObjectKey, {
      queries: { 'response-content-disposition': disposition },
    });
    return response(302, '', { Location: location });
  }
  return response(200, await externalRecord(client, record, true));
}

exports.handler = async (rawEvent, context) => {
  let event;
  try {
    event = parseEvent(rawEvent);
  } catch {
    return response(400, { error: 'Invalid event' });
  }
  const method = requestMethod(event);
  const path = requestPath(event);
  if (method === 'OPTIONS') return response(204, '');
  try {
    const client = clientFor(context);
    if (method === 'GET' && path.endsWith('/entries')) return listEntries(client);
    const downloadMatch = path.match(/\/photos\/([A-Za-z0-9_-]{24,64})\/download$/);
    if (method === 'GET' && downloadMatch) return getPhoto(client, downloadMatch[1], true);
    const photoMatch = path.match(/\/photos\/([A-Za-z0-9_-]{24,64})$/);
    if (method === 'GET' && photoMatch) return getPhoto(client, photoMatch[1], false);
    if (method === 'POST' && !authorized(event)) return response(401, { error: 'Unauthorized' });
    if (method === 'POST' && path.endsWith('/codes')) return reserveCode(client, requestBody(event));
    if (method === 'POST' && path.endsWith('/uploads')) return createUploads(client, requestBody(event));
    if (method === 'POST' && path.endsWith('/entries')) return addEntry(client, requestBody(event));
    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return response(500, {
      error: 'Photo service failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
