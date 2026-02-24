/**
 * @maitask/http-client
 * HTTP client with retries, timeout, and authentication helpers
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const url = readRequiredString(payload.url, 'url');
    const method = normalizeMethod(payload.method || 'GET');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);
    const retries = toBoundedInteger(payload.retries ?? options.retries, 0, 5, 0);

    const headers = {
      ...asHeaders(payload.headers),
      ...buildAuthHeaders(payload.auth)
    };

    const requestBody = buildRequestBody(payload.body);
    if (requestBody != null && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetchWithTimeout(url, {
          method,
          headers,
          body: requestBody,
          timeoutMs
        });

        const raw = await response.text();
        const parsed = tryParseJson(raw);
        const data = {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: parsed == null ? raw : parsed
        };

        if (!response.ok) {
          return {
            success: false,
            data,
            error: {
              message: `HTTP request failed with status ${response.status}`,
              code: 'HTTP_CLIENT_RESPONSE_ERROR',
              type: 'HttpClientResponseError'
            },
            metadata: {
              attempt: attempt + 1,
              timestamp: new Date().toISOString(),
              version: '0.1.0'
            }
          };
        }

        return {
          success: true,
          data,
          metadata: {
            attempt: attempt + 1,
            timestamp: new Date().toISOString(),
            version: '0.1.0'
          }
        };
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await sleep(250 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error('Request failed');
  } catch (error) {
    return buildError(error, 'HTTP_CLIENT_ERROR', 'HttpClientError');
  }
}

execute;

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

function buildRequestBody(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  if (!method) return 'GET';
  return method;
}

function buildAuthHeaders(auth) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    return {};
  }

  if (auth.type === 'bearer') {
    const token = readRequiredString(auth.token, 'auth.token');
    return { Authorization: `Bearer ${token}` };
  }

  if (auth.type === 'basic') {
    const username = readRequiredString(auth.username, 'auth.username');
    const password = readRequiredString(auth.password, 'auth.password');
    return { Authorization: `Basic ${encodeBase64(`${username}:${password}`)}` };
  }

  if (auth.type === 'apikey') {
    const key = readRequiredString(auth.key, 'auth.key');
    const headerName = readRequiredString(auth.header || 'X-API-Key', 'auth.header');
    return { [headerName]: key };
  }

  throw new Error(`Unsupported auth type '${auth.type}'`);
}

function encodeBase64(value) {
  if (typeof btoa === 'function') return btoa(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'utf8').toString('base64');
  throw new Error('Base64 encoding is not available in this runtime');
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

function toBoundedInteger(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.floor(num);
  return Math.min(max, Math.max(min, rounded));
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
