/**
 * @maitask/database-query
 * SQL query execution via HTTP database proxy endpoints
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const query = readRequiredString(payload.query, 'query');
    const database = readRequiredString(payload.database, 'database');
    const dbType = normalizeDbType(payload.type || payload.databaseType || 'postgresql');

    const endpoint = resolveEndpoint(payload, options, dbType);
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const headers = {
      'Content-Type': 'application/json',
      ...asHeaders(payload.headers)
    };

    if (payload.username || payload.password) {
      const username = readRequiredString(payload.username, 'username');
      const password = readRequiredString(payload.password, 'password');
      headers.Authorization = `Basic ${encodeBase64(`${username}:${password}`)}`;
    }

    const body = {
      type: dbType,
      database,
      query,
      params: Array.isArray(payload.params) ? payload.params : []
    };

    const result = await fetchJson(endpoint, {
      method: 'POST',
      headers,
      body,
      timeoutMs
    });

    const rows = Array.isArray(result.rows) ? result.rows : [];

    return {
      success: true,
      data: {
        rows,
        rowCount: toNonNegativeInteger(result.rowCount, rows.length),
        fields: Array.isArray(result.fields) ? result.fields : [],
        query
      },
      metadata: {
        database,
        databaseType: dbType,
        endpoint,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'DATABASE_QUERY_ERROR', 'DatabaseQueryError');
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

function normalizeDbType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'postgresql' || type === 'mysql' || type === 'sqlite') {
    return type;
  }
  throw new Error(`Unsupported database type '${value}'. Use 'postgresql', 'mysql', or 'sqlite'.`);
}

function resolveEndpoint(payload, options, dbType) {
  const explicit = readOptionalString(payload.proxyUrl || payload.endpoint || options.proxyUrl || options.endpoint, '');
  if (explicit) {
    return explicit;
  }

  const host = readRequiredString(payload.host, 'host');
  const port = toPositiveInteger(payload.port, dbType === 'mysql' ? 3306 : 5432);
  return `http://${host}:${port}/query`;
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
    const json = tryParseJson(text);

    if (!response.ok) {
      throw new Error(json?.error?.message || json?.message || text || `Request failed with status ${response.status}`);
    }

    return json == null ? {} : json;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function encodeBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  throw new Error('Base64 encoding is not available in this runtime');
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
  const text = readOptionalString(value);
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readOptionalString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function toPositiveInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function toNonNegativeInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
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
