/**
 * @maitask/redis-cache
 * Redis cache operations through HTTP proxy endpoints
 *
 * @version 0.1.0
 * @license MIT
 */

const ALLOWED_OPERATIONS = new Set(['get', 'set', 'delete', 'expire', 'exists']);

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const operation = normalizeOperation(payload.operation);
    const key = readRequiredString(payload.key, 'key');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const endpoint = resolveEndpoint(payload, options);

    if (operation === 'set' && payload.value == null) {
      throw new Error('value is required for set operation');
    }

    const body = {
      operation,
      key,
      value: payload.value,
      ttl: payload.ttl == null ? null : toPositiveInteger(payload.ttl, null)
    };

    const result = await fetchJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...asHeaders(payload.headers)
      },
      body,
      timeoutMs
    });

    return {
      success: true,
      data: {
        operation,
        key,
        result: result.result ?? result.value ?? null,
        raw: result
      },
      metadata: {
        endpoint,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'REDIS_CACHE_ERROR', 'RedisCacheError');
  }
}

execute;

function normalizeOperation(value) {
  const op = String(value || '').trim().toLowerCase();
  if (!ALLOWED_OPERATIONS.has(op)) {
    throw new Error(`Unsupported operation '${value}'. Use get/set/delete/expire/exists.`);
  }
  return op;
}

function resolveEndpoint(payload, options) {
  const explicit = readOptionalString(payload.proxyUrl || payload.endpoint || options.proxyUrl || options.endpoint, '');
  if (explicit) return explicit;

  const host = readOptionalString(payload.host, 'localhost');
  const port = toPositiveInteger(payload.port, 6379);
  return `http://${host}:${port}/redis`;
}

async function fetchJson(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    const data = tryParseJson(text);

    if (!response.ok) {
      throw new Error(data?.message || data?.error?.message || text || `Request failed with status ${response.status}`);
    }

    return data == null ? {} : data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
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

function readRequiredString(value, key) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readOptionalString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function toPositiveInteger(value, fallback) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
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
      version: '0.1.0'
    }
  };
}
