/**
 * @maitask/s3-storage
 * S3-compatible object storage operations via presigned URLs
 *
 * @version 0.1.0
 * @license MIT
 */

const OPERATIONS = new Set(['list', 'upload', 'download', 'delete']);

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const operation = normalizeOperation(payload.operation);
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const result = await runWithPresignedUrl(operation, payload, timeoutMs);

    return {
      success: true,
      data: result,
      metadata: {
        operation,
        timestamp: new Date().toISOString(),
        version: '0.1.1'
      }
    };
  } catch (error) {
    return buildError(error, 'S3_STORAGE_ERROR', 'S3StorageError');
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

function normalizeOperation(value) {
  const operation = String(value || '').trim().toLowerCase();
  if (!OPERATIONS.has(operation)) {
    throw new Error(`Unsupported operation '${value}'. Use list/upload/download/delete.`);
  }
  return operation;
}

async function runWithPresignedUrl(operation, payload, timeoutMs) {
  const url = readRequiredString(payload.presignedUrl, 'presignedUrl');

  if (operation === 'list') {
    throw new Error('list is not supported; provide a presigned upload, download, or delete URL');
  }

  if (operation === 'upload') {
    if (payload.body == null) {
      throw new Error('body is required for upload');
    }

    const response = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: asHeaders(payload.headers),
      body: serializeBody(payload.body),
      timeoutMs
    });

    await ensureOk(response);

    return {
      mode: 'presigned-url',
      uploaded: true,
      status: response.status
    };
  }

  if (operation === 'download') {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: asHeaders(payload.headers),
      timeoutMs
    });
    await ensureOk(response);

    const content = await response.text();
    return {
      mode: 'presigned-url',
      content,
      size: content.length,
      status: response.status
    };
  }

  const response = await fetchWithTimeout(url, {
    method: 'DELETE',
    headers: asHeaders(payload.headers),
    timeoutMs
  });
  await ensureOk(response);

  return {
    mode: 'presigned-url',
    deleted: true,
    status: response.status
  };
}

async function fetchWithTimeout(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureOk(response) {
  if (response.ok) return;
  const text = await response.text();
  const json = tryParseJson(text);
  throw new Error(json?.message || json?.error?.message || text || `Request failed with status ${response.status}`);
}

function serializeBody(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function asHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers = {};
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    headers[key] = String(item);
  }
  return headers;
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
}

function readRequiredString(value, key) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 30000;
  return Math.min(timeout, 120000);
}

function buildError(error, code, type) {
  return {
    success: false,
    error: {
      message: error?.message || 'Unknown error',
      code,
      type
    },
    metadata: {
      timestamp: new Date().toISOString(),
      version: '0.1.1'
    }
  };
}
