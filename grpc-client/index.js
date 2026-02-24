/**
 * @maitask/grpc-client
 * gRPC invocation through HTTP/JSON transcoding gateways
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const host = readRequiredString(payload.host, 'host');
    const service = readRequiredString(payload.service, 'service');
    const method = readRequiredString(payload.method, 'method');
    const port = toPositiveInteger(payload.port, 8080);
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const url = `http://${host}:${port}/${encodeURIComponent(service)}/${encodeURIComponent(method)}`;

    const result = await fetchJson(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...asHeaders(payload.headers)
      },
      body: payload.body == null ? {} : payload.body,
      timeoutMs
    });

    return {
      success: true,
      data: {
        service,
        method,
        response: result
      },
      metadata: {
        host,
        port,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'GRPC_CLIENT_ERROR', 'GrpcClientError');
  }
}

execute;

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

function toPositiveInteger(value, fallback) {
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
