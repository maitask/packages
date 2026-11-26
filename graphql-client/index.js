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
    const safeOptions = asObjectOrEmpty(options);
    const safeContext = asObjectOrEmpty(context);
    const payload = asObject(input);
    const url = readRequiredUrl(
      payload.url,
      safeOptions.allowInsecureHttp === true,
      safeOptions.allowPrivateHosts === true
    );
    const query = readRequiredString(payload.query, 'query');
    const timeoutMs = readTimeout(payload.timeoutMs ?? safeOptions.timeoutMs);
    const secrets = Object.create(null);
    copySafeOwnEntries(secrets, asObjectOrEmpty(safeOptions.secrets));
    copySafeOwnEntries(secrets, asObjectOrEmpty(safeContext.secrets));
    for (const key of Object.keys(secrets)) {
      const value = secrets[key];
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
    const tokenSecret = readOptionalString(safeOptions.tokenSecret);
    if (tokenSecret) {
      if (!isSafeKey(tokenSecret) || !Object.hasOwn(secrets, tokenSecret)) {
        throw new Error(`${tokenSecret} is required`);
      }
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
  const runtimeFetch = usesMaitaskRuntimeFetch();
  const controller = runtimeFetch ? null : new AbortController();
  const timer = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchInit = {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      timeoutMs
    };
    if (runtimeFetch) {
      fetchInit.maxResponseBytes = MAX_RESPONSE_BYTES;
    } else {
      fetchInit.signal = controller.signal;
    }
    const response = await fetch(url, fetchInit);
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
    if (timer !== null) {
      clearTimeout(timer);
    }
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
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(value, key) || !isSafeKey(key)) continue;
    const item = value[key];
    if (item == null) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(String(item))) {
      throw new Error(`Invalid header '${key}'`);
    }
    headers[key] = String(item);
  }
  return headers;
}

function isSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function copySafeOwnEntries(target, source) {
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(source, key) && isSafeKey(key)) {
      target[key] = source[key];
    }
  }
}

function usesMaitaskRuntimeFetch() {
  return Boolean(
    typeof Deno !== 'undefined' &&
    Deno &&
    Deno.core &&
    Deno.core.ops &&
    typeof Deno.core.ops.op_http_request === 'function'
  );
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

function readRequiredUrl(value, allowInsecureHttp, allowPrivateHosts) {
  const url = new URL(readRequiredString(value, 'url'));
  if (url.username || url.password) {
    throw new Error('url must not include embedded credentials');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error('url must use https unless allowInsecureHttp is enabled');
  }
  if (!allowPrivateHosts && isBlockedHost(url.hostname)) {
    throw new Error('url must not point to a private or internal host');
  }
  return url.toString();
}

function isBlockedHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized === 'local' ||
    normalized === 'internal' ||
    normalized === 'localdomain' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.localdomain')
  ) {
    return true;
  }
  if (normalized.includes(':')) {
    const clean = normalized.split('%')[0];
    const hextets = parseIpv6Hextets(clean);
    if (!hextets) return true;
    const allZero = hextets.every(part => part === 0);
    const isLoopback = hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1;
    if (allZero || isLoopback) return true;
    if ((hextets[0] & 0xffc0) === 0xfe80) return true;
    if ((hextets[0] & 0xfe00) === 0xfc00) return true;
    if (hextets.slice(0, 5).every(part => part === 0) && hextets[5] === 0xffff) return true;
    return false;
  }
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [, a, b, c, d] = ipv4.map(Number);
  if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return true;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseIpv6Hextets(address) {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parsePart = part => {
    if (!part) return [];
    const tokens = part.split(':');
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) return null;
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (!v4) return null;
        const octets = v4.slice(1).map(Number);
        if (octets.some(o => o < 0 || o > 255)) return null;
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        out.push(parseInt(token, 16));
      }
    }
    return out;
  };
  const left = parsePart(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parsePart(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
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
