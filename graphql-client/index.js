/**
 * @maitask/graphql-client
 * GraphQL query/mutation execution over HTTPS
 *
 * @version 0.1.1
 * @license MIT
 */

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;

async function execute(input, options = {}, context = {}) {
  const activeSecrets = [];
  try {
    const payload = asObject(input);
    const url = readRequiredUrl(payload.url, options.allowInsecureHttp === true);
    const query = readRequiredString(payload.query, 'query');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);
    const secrets = {
      ...asObjectOrEmpty(options.secrets),
      ...asObjectOrEmpty(context.secrets)
    };
    for (const value of Object.values(secrets)) {
      if (typeof value === 'string' && value) {
        activeSecrets.push(value);
      }
    }
    const parsedMetaUrl = new URL(url);
    const safeMetaUrl = `${parsedMetaUrl.origin}${parsedMetaUrl.pathname}`;

    const requestBody = {
      query,
      variables: asObjectOrDefault(payload.variables, {})
    };

    const headers = {
      'Content-Type': 'application/json',
      ...asHeaders(payload.headers)
    };
    const tokenSecret = readOptionalString(payload.tokenSecret || options.tokenSecret);
    if (tokenSecret) {
      headers.Authorization = `Bearer ${readRequiredString(secrets[tokenSecret], tokenSecret)}`;
    }

    const result = await fetchJson(url, {
      method: 'POST',
      headers,
      body: requestBody,
      timeoutMs
    });

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const hasData = result.data != null;

    if (errors.length > 0) {
      return {
        success: false,
        data: {
          data: hasData ? result.data : null,
          errors,
          extensions: result.extensions || null
        },
        error: {
          message: 'GraphQL responded with one or more errors',
          code: 'GRAPHQL_RESPONSE_ERROR',
          type: 'GraphQLResponseError'
        },
        metadata: {
          package: '@maitask/graphql-client',
          url: safeMetaUrl,
          timestamp: new Date().toISOString(),
          version: '0.1.1'
        }
      };
    }

    return {
      success: true,
      data: {
        data: hasData ? result.data : null,
        errors: [],
        extensions: result.extensions || null
      },
      metadata: {
        package: '@maitask/graphql-client',
        url: safeMetaUrl,
        timestamp: new Date().toISOString(),
        version: '0.1.1'
      }
    };
  } catch (error) {
    return buildError(error, 'GRAPHQL_CLIENT_ERROR', 'GraphQLClientError', activeSecrets);
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
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
      redirect: 'manual',
      timeoutMs,
      signal: controller.signal
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new Error('GraphQL client does not follow HTTP redirects');
    }

    if (!response.ok) {
      const errorText = await readBoundedText(response, MAX_ERROR_BYTES, false);
      const errorJson = tryParseJson(errorText);
      throw new Error(errorJson?.errors?.[0]?.message || errorJson?.message || errorText || `Request failed with status ${response.status}`);
    }

    const text = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
    const json = tryParseJson(text);

    if (json == null) {
      throw new Error('GraphQL response is not valid JSON');
    }

    return json;
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

function asObjectOrDefault(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('variables must be an object');
  }
  return value;
}

function asHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(String(item))) {
      throw new Error(`Invalid header '${key}'`);
    }
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

function readOptionalString(value) {
  return value == null ? '' : String(value).trim();
}

function asObjectOrEmpty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function readRequiredUrl(value, allowInsecureHttp) {
  const url = new URL(readRequiredString(value, 'url'));
  if (url.username || url.password) {
    throw new Error('url must not include embedded credentials');
  }
  if (url.protocol === 'https:') {
    return url.toString();
  }
  if (url.protocol === 'http:' && allowInsecureHttp) {
    return url.toString();
  }
  throw new Error('url must use https unless allowInsecureHttp is enabled');
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 30000;
  return Math.min(timeout, 120000);
}

async function readBoundedText(response, maxBytes, throwOnLimit) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    let out = '';
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (totalBytes + value.byteLength > maxBytes) {
          if (throwOnLimit) {
            throw new Error(`GraphQL response exceeds ${maxBytes} byte limit`);
          }
          const remaining = maxBytes - totalBytes;
          if (remaining > 0) {
            const slice = value.subarray(0, remaining);
            out += decoder ? decoder.decode(slice, { stream: true }) : String.fromCharCode(...slice);
          }
          break;
        }
        out += decoder ? decoder.decode(value, { stream: true }) : String.fromCharCode(...value);
        totalBytes += value.byteLength;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
    if (decoder) out += decoder.decode();
    return out;
  }
  const text = await response.text();
  if (typeof text === 'string' && text.length > maxBytes) {
    if (throwOnLimit) {
      throw new Error(`GraphQL response exceeds ${maxBytes} byte limit`);
    }
    return text.slice(0, maxBytes);
  }
  return text || '';
}

function buildError(error, code, type, activeSecrets = []) {
  let safeMessage = String(error?.message || 'Unknown error');
  for (const secret of activeSecrets || []) {
    if (typeof secret === 'string' && secret) {
      safeMessage = safeMessage.split(secret).join('[redacted]');
    }
  }
  safeMessage = safeMessage.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  return {
    success: false,
    error: {
      message: safeMessage,
      code,
      type
    },
    metadata: {
      package: '@maitask/graphql-client',
      timestamp: new Date().toISOString(),
      version: '0.1.1'
    }
  };
}
