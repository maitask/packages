/**
 * @maitask/http-request
 * Strict, credential-confined HTTP client for Maitask Runtime.
 */

const PACKAGE_NAME = '@maitask/http-request';
const PACKAGE_VERSION = '2.0.0';
const CONTRACT_VERSION = '2026-07-11';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_RETRY_STATUSES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);
const INPUT_FIELDS = new Set([
  'url', 'method', 'query', 'headers', 'auth', 'json', 'text', 'bodyBase64', 'form',
  'multipart', 'responseType', 'acceptedStatuses', 'acceptedStatusRange', 'redirect',
  'timeoutMs', 'maxResponseBytes', 'maxRedirects', 'retry'
]);
const OPTION_FIELDS = new Set([
  'timeoutMs', 'maxResponseBytes', 'maxRedirects', 'allowInsecureHttp', 'allowedHosts', 'secrets'
]);
const AUTH_FIELDS = Object.freeze({
  bearer: new Set(['type', 'tokenSecret']),
  basic: new Set(['type', 'usernameSecret', 'passwordSecret']),
  apiKey: new Set(['type', 'header', 'valueSecret'])
});
const RETRY_FIELDS = new Set([
  'maxAttempts', 'statuses', 'initialDelayMs', 'maxDelayMs', 'backoffFactor',
  'jitterRatio', 'respectRetryAfter'
]);
const MULTIPART_FILE_FIELDS = new Set(['filename', 'contentType', 'bodyBase64']);
const STATUS_RANGE_FIELDS = new Set(['min', 'max']);
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'user-agent']);
const PROTECTED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'host', 'content-length',
  'transfer-encoding', 'connection', 'proxy-connection', 'keep-alive', 'upgrade',
  'te', 'trailer', 'user-agent'
]);

class HttpRequestFailure extends Error {
  constructor(code, message, type, properties = {}) {
    super(message);
    this.name = type;
    this.code = code;
    this.type = type;
    if (properties.status !== undefined) this.status = properties.status;
    if (properties.retriable !== undefined) this.retriable = properties.retriable;
  }
}

async function execute(rawInput, rawOptions = {}, rawContext = {}) {
  const startedAt = Date.now();
  let config = null;
  let attempts = 0;
  let redirects = 0;
  try {
    ensureTransport();
    config = buildConfig(rawInput, rawOptions, rawContext);
    const operation = await executeRequest(config, progress => {
      attempts = progress.attempts;
      redirects = progress.redirects;
    });
    attempts = operation.attempts;
    redirects = operation.redirects;
    return buildSuccess(config, operation, startedAt);
  } catch (error) {
    const failure = normalizeFailure(error);
    return {
      success: false,
      error: failure,
      metadata: {
        contractVersion: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        executionId: config ? config.executionId : readSafeExecutionId(rawContext),
        method: config ? config.method : null,
        attempts,
        redirects,
        executedAt: new Date().toISOString(),
        executionMs: Date.now() - startedAt
      },
      citations: []
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;

function buildConfig(rawInput, rawOptions, rawContext) {
  const input = snapshotKnownRecord(rawInput, INPUT_FIELDS);
  const options = snapshotKnownRecord(rawOptions, OPTION_FIELDS);
  const context = readContext(rawContext);
  const optionSecrets = options.secrets === undefined ? Object.create(null) : snapshotSecrets(options.secrets);
  const method = optionalEnum(input.method, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], 'GET');
  const optionTimeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 120_000);
  const optionMaxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    50 * 1024 * 1024
  );
  const optionMaxRedirects = boundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 10);
  const timeoutMs = tightenInteger(input.timeoutMs, optionTimeoutMs, 10, 120_000);
  const maxResponseBytes = tightenInteger(
    input.maxResponseBytes,
    optionMaxResponseBytes,
    1,
    50 * 1024 * 1024
  );
  const maxRedirects = tightenInteger(input.maxRedirects, optionMaxRedirects, 0, 10);
  const allowInsecureHttp = optionalBoolean(options.allowInsecureHttp, false);
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  const url = normalizeUrl(requiredString(input.url, 16_384), allowInsecureHttp, allowedHosts);
  const query = input.query === undefined ? null : snapshotParameterRecord(input.query, 'query');
  const target = appendQuery(url, query);
  const callerHeaders = normalizeRequestHeaders(input.headers);
  const auth = normalizeAuth(input.auth, optionSecrets, context.secrets);
  if (auth && hasOwn(callerHeaders, auth.header)) throw validationFailure();
  const body = buildRequestBody(input, method, callerHeaders);
  const responseType = optionalEnum(input.responseType, ['json', 'text', 'base64'], 'json');
  const acceptedStatus = normalizeAcceptedStatus(input.acceptedStatuses, input.acceptedStatusRange);
  const redirect = optionalEnum(input.redirect, ['follow', 'manual', 'error'], 'follow');
  const retry = normalizeRetry(input.retry, method);

  const headers = cloneRecord(callerHeaders);
  if (auth) headers[auth.header] = auth.value;
  headers['user-agent'] = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;

  return {
    url: target,
    method,
    callerHeaders,
    headers,
    body,
    responseType,
    acceptedStatus,
    redirect,
    retry,
    timeoutMs,
    maxResponseBytes,
    maxRedirects,
    allowInsecureHttp,
    allowedHosts,
    executionId: context.executionId
  };
}

async function executeRequest(config, updateProgress) {
  const state = {
    deadlineAt: Date.now() + config.timeoutMs,
    attempts: 0,
    redirects: 0
  };
  let lastFailure = null;

  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt += 1) {
    state.attempts = attempt;
    updateProgress(state);
    let response;
    try {
      response = await requestWithRedirects(config, state);
    } catch (error) {
      const failure = error instanceof HttpRequestFailure ? error : upstreamFailure();
      lastFailure = failure;
      if (!canRetryFailure(failure, config, attempt)) throw failure;
      await waitForRetry(config.retry, attempt, null, state);
      continue;
    }

    if (config.acceptedStatus(response.status)) {
      const body = parseResponseBody(response.bytes, config.responseType, response.status);
      return {
        response,
        body,
        attempts: state.attempts,
        redirects: state.redirects
      };
    }

    const failure = statusFailure(response.status, config.retry.statuses.has(response.status));
    lastFailure = failure;
    if (!canRetryFailure(failure, config, attempt)) throw failure;
    await waitForRetry(config.retry, attempt, response.headers['retry-after'], state);
  }

  throw lastFailure || upstreamFailure();
}

async function requestWithRedirects(config, state) {
  let url = config.url;
  let headers = cloneRecord(config.headers);
  let redirects = 0;

  while (true) {
    const response = await requestOnce(url, config.method, headers, config.body, config, state);
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (config.redirect === 'manual') return response;
    if (config.redirect === 'error') throw redirectFailure();
    if (config.method !== 'GET' && config.method !== 'HEAD') throw redirectFailure();
    if (redirects >= config.maxRedirects) throw redirectFailure();
    const location = response.headers.location;
    if (!location) throw redirectFailure();

    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw redirectFailure();
    }
    if (new URL(url).protocol === 'https:' && next.protocol !== 'https:') throw redirectFailure();
    const normalized = normalizeUrl(next.toString(), config.allowInsecureHttp, config.allowedHosts);
    if (new URL(normalized).origin !== new URL(url).origin) {
      headers = retainCrossOriginHeaders(headers);
    }
    url = normalized;
    redirects += 1;
    state.redirects += 1;
  }
}

async function requestOnce(url, method, headers, body, config, state) {
  const remainingMs = remainingTime(state);
  if (remainingMs <= 0) throw timeoutFailure();

  if (hasRuntimeHttpOperation()) {
    return requestViaRuntimeOperation(url, method, headers, body, config, remainingMs);
  }
  return requestViaFetch(url, method, headers, body, config, remainingMs);
}

async function requestViaRuntimeOperation(url, method, headers, body, config, timeoutMs) {
  const request = {
    method,
    headers,
    redirect: 'manual',
    timeoutMs,
    maxResponseBytes: config.maxResponseBytes
  };
  if (body) {
    if (body.kind === 'text') request.body = body.value;
    else request.bodyBase64 = bytesToBase64(body.bytes);
  }

  try {
    const raw = await globalThis.Deno.core.ops.op_http_request(url, request);
    return normalizeRuntimeResponse(raw, config.maxResponseBytes);
  } catch (error) {
    throw classifyTransportError(error);
  }
}

async function requestViaFetch(url, method, headers, body, config, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? (body.kind === 'text' ? body.value : body.bytes) : undefined,
      redirect: 'manual',
      signal: controller.signal,
      timeoutMs,
      maxResponseBytes: config.maxResponseBytes
    });
    const responseHeaders = normalizeResponseHeaders(response.headers);
    const bytes = await readResponseBytes(response, config.maxResponseBytes, controller);
    return {
      status: normalizeResponseStatus(response.status),
      statusText: typeof response.statusText === 'string' ? response.statusText : '',
      headers: responseHeaders,
      bytes
    };
  } catch (error) {
    throw classifyTransportError(error, controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBytes(response, maxResponseBytes, controller) {
  const length = Number(response.headers && response.headers.get
    ? response.headers.get('content-length')
    : null);
  if (Number.isFinite(length) && length > maxResponseBytes) {
    controller.abort();
    throw responseTooLargeFailure();
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value);
        total += chunk.byteLength;
        if (total > maxResponseBytes) {
          controller.abort();
          throw responseTooLargeFailure();
        }
        chunks.push(chunk.slice());
      }
    } finally {
      try { reader.releaseLock(); } catch { /* no-op */ }
    }
    return concatenateBytes(chunks, total);
  }

  if (!response || typeof response.arrayBuffer !== 'function') throw upstreamFailure();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxResponseBytes) throw responseTooLargeFailure();
  return bytes;
}

function normalizeRuntimeResponse(raw, maxResponseBytes) {
  const response = snapshotKnownRecord(raw, new Set(['status', 'ok', 'headers', 'bodyBase64', 'bodyBytes']));
  const status = normalizeResponseStatus(response.status);
  const headers = normalizeRuntimeHeaders(response.headers);
  if (typeof response.bodyBase64 !== 'string' || !isCanonicalBase64(response.bodyBase64)) {
    throw upstreamFailure();
  }
  const bytes = base64ToBytes(response.bodyBase64);
  if (bytes.byteLength > maxResponseBytes) throw responseTooLargeFailure();
  if (response.bodyBytes !== undefined && response.bodyBytes !== bytes.byteLength) throw upstreamFailure();
  return { status, statusText: status >= 200 && status < 300 ? 'OK' : 'Error', headers, bytes };
}

function buildSuccess(config, operation, startedAt) {
  const response = operation.response;
  const bodyBase64 = bytesToBase64(response.bytes);
  const item = {
    index: 0,
    data: {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: operation.body,
      bodyBase64,
      bodyBytes: response.bytes.byteLength
    },
    metadata: {
      accepted: true,
      status: response.status
    }
  };
  return {
    success: true,
    data: {
      items: [item],
      summary: {
        total: 1,
        success_count: 1,
        failure_count: 0,
        metrics: { status: response.status }
      }
    },
    error: null,
    metadata: {
      contractVersion: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      executionId: config.executionId,
      method: config.method,
      status: response.status,
      attempts: operation.attempts,
      redirects: operation.redirects,
      executedAt: new Date().toISOString(),
      executionMs: Date.now() - startedAt
    },
    citations: []
  };
}

function buildRequestBody(input, method, headers) {
  const fields = ['json', 'text', 'bodyBase64', 'form', 'multipart'];
  const present = fields.filter(field => input[field] !== undefined);
  if (present.length > 1) throw validationFailure();
  if ((method === 'GET' || method === 'HEAD') && present.length > 0) throw validationFailure();
  if (present.length === 0) return null;

  switch (present[0]) {
    case 'json': {
      const value = snapshotJson(input.json);
      let serialized;
      try { serialized = JSON.stringify(value); } catch { throw validationFailure(); }
      setGeneratedContentType(headers, 'application/json; charset=utf-8');
      return { kind: 'text', value: serialized };
    }
    case 'text': {
      if (typeof input.text !== 'string' || input.text.length > 50 * 1024 * 1024) throw validationFailure();
      setGeneratedContentType(headers, 'text/plain; charset=utf-8');
      return { kind: 'text', value: input.text };
    }
    case 'bodyBase64': {
      if (typeof input.bodyBase64 !== 'string' || !isCanonicalBase64(input.bodyBase64)) {
        throw validationFailure();
      }
      const bytes = base64ToBytes(input.bodyBase64);
      if (bytes.byteLength > 50 * 1024 * 1024) throw validationFailure();
      setGeneratedContentType(headers, 'application/octet-stream');
      return { kind: 'bytes', bytes };
    }
    case 'form': {
      const form = snapshotParameterRecord(input.form, 'form');
      const values = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) {
        for (const item of Array.isArray(value) ? value : [value]) values.append(key, String(item));
      }
      setGeneratedContentType(headers, 'application/x-www-form-urlencoded; charset=utf-8');
      return { kind: 'text', value: values.toString() };
    }
    case 'multipart': {
      if (hasOwn(headers, 'content-type')) throw validationFailure();
      const multipart = snapshotMultipart(input.multipart);
      const encoded = encodeMultipart(multipart);
      setGeneratedContentType(headers, `multipart/form-data; boundary=${encoded.boundary}`);
      return { kind: 'bytes', bytes: encoded.bytes };
    }
    default:
      throw validationFailure();
  }
}

function normalizeAuth(value, optionSecrets, contextSecrets) {
  if (value === undefined) return null;
  const inspected = inspectRecord(value);
  const typeDescriptor = inspected.descriptors.type;
  if (!typeDescriptor || !hasOwn(typeDescriptor, 'value') || typeof typeDescriptor.value !== 'string') {
    throw validationFailure();
  }
  const type = typeDescriptor.value;
  const allowed = AUTH_FIELDS[type];
  if (!allowed) throw validationFailure();
  const auth = snapshotKnownRecord(value, allowed);

  if (type === 'bearer') {
    const token = resolveSecret(requiredSecretName(auth.tokenSecret), optionSecrets, contextSecrets);
    validateSecretHeaderValue(token);
    return { header: 'authorization', value: `Bearer ${token}` };
  }
  if (type === 'basic') {
    const username = resolveSecret(requiredSecretName(auth.usernameSecret), optionSecrets, contextSecrets);
    const password = resolveSecret(requiredSecretName(auth.passwordSecret), optionSecrets, contextSecrets);
    validateSecretHeaderValue(username);
    validateSecretHeaderValue(password);
    return { header: 'authorization', value: `Basic ${encodeUtf8Base64(`${username}:${password}`)}` };
  }

  const header = normalizeHeaderName(auth.header);
  if (PROTECTED_HEADERS.has(header)) throw validationFailure();
  const secret = resolveSecret(requiredSecretName(auth.valueSecret), optionSecrets, contextSecrets);
  validateSecretHeaderValue(secret);
  return { header, value: secret };
}

function normalizeRetry(value, method) {
  const safe = SAFE_RETRY_METHODS.has(method);
  const record = value === undefined ? Object.create(null) : snapshotKnownRecord(value, RETRY_FIELDS);
  const maxAttempts = boundedInteger(record.maxAttempts, safe ? 3 : 1, 1, 5);
  if (!safe && maxAttempts !== 1) throw validationFailure();
  const statuses = record.statuses === undefined
    ? new Set(DEFAULT_RETRY_STATUSES)
    : new Set(snapshotIntegerArray(record.statuses, 400, 599, 32));
  return {
    maxAttempts,
    statuses,
    initialDelayMs: boundedInteger(record.initialDelayMs, 250, 0, 30_000),
    maxDelayMs: boundedInteger(record.maxDelayMs, 5_000, 0, 60_000),
    backoffFactor: boundedNumber(record.backoffFactor, 2, 1, 10),
    jitterRatio: boundedNumber(record.jitterRatio, 0.2, 0, 1),
    respectRetryAfter: optionalBoolean(record.respectRetryAfter, true)
  };
}

function normalizeAcceptedStatus(statusesValue, rangeValue) {
  if (statusesValue !== undefined && rangeValue !== undefined) throw validationFailure();
  if (statusesValue !== undefined) {
    const statuses = new Set(snapshotIntegerArray(statusesValue, 100, 599, 100));
    if (statuses.size === 0) throw validationFailure();
    return status => statuses.has(status);
  }
  if (rangeValue !== undefined) {
    const range = snapshotKnownRecord(rangeValue, STATUS_RANGE_FIELDS);
    const min = boundedInteger(range.min, 200, 100, 599);
    const max = boundedInteger(range.max, 299, 100, 599);
    if (min > max) throw validationFailure();
    return status => status >= min && status <= max;
  }
  return status => status >= 200 && status <= 299;
}

function parseResponseBody(bytes, responseType, status) {
  if (status === 204 || status === 205 || bytes.byteLength === 0) {
    return responseType === 'base64' ? '' : null;
  }
  if (responseType === 'base64') return bytesToBase64(bytes);
  let text;
  try {
    text = decodeUtf8Fatal(bytes);
  } catch {
    throw responseParseFailure();
  }
  if (responseType === 'text') return text;
  try {
    const validated = snapshotJson(JSON.parse(text));
    return JSON.parse(JSON.stringify(validated));
  } catch {
    throw responseParseFailure();
  }
}

function normalizeRequestHeaders(value) {
  const result = Object.create(null);
  if (value === undefined) return result;
  const record = snapshotOpenRecord(value);
  let totalBytes = 0;
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(record)) {
    const name = normalizeHeaderName(rawName);
    if (PROTECTED_HEADERS.has(name) || name.startsWith('sec-')) throw validationFailure();
    if (typeof rawValue !== 'string' || rawValue.length > 16_384 || /[\r\n\0]/.test(rawValue)) {
      throw validationFailure();
    }
    if (hasOwn(result, name)) throw validationFailure();
    totalBytes += name.length + rawValue.length;
    count += 1;
    if (count > 100 || totalBytes > 64 * 1024) throw validationFailure();
    result[name] = rawValue.trim();
  }
  return result;
}

function normalizeResponseHeaders(headers) {
  if (!headers || typeof headers.forEach !== 'function') throw upstreamFailure();
  const result = Object.create(null);
  try {
    headers.forEach((value, key) => {
      if (typeof key !== 'string' || typeof value !== 'string') throw upstreamFailure();
      result[key.toLowerCase()] = value;
    });
  } catch (error) {
    if (error instanceof HttpRequestFailure) throw error;
    throw upstreamFailure();
  }
  return result;
}

function normalizeRuntimeHeaders(value) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string' || /[\r\n\0]/.test(item)) throw upstreamFailure();
    const name = normalizeHeaderName(key);
    if (hasOwn(result, name)) throw upstreamFailure();
    result[name] = item;
  }
  return result;
}

function snapshotMultipart(value) {
  const record = snapshotOpenRecord(value);
  const result = [];
  let entries = 0;
  for (const [name, rawValue] of Object.entries(record)) {
    validateMultipartName(name);
    const values = Array.isArray(rawValue) ? snapshotArray(rawValue) : [rawValue];
    if (values.length === 0) throw validationFailure();
    for (const item of values) {
      entries += 1;
      if (entries > 1000) throw validationFailure();
      result.push({ name, value: snapshotMultipartValue(item) });
    }
  }
  return result;
}

function snapshotMultipartValue(value) {
  if (typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) {
    return { kind: 'text', value: String(value) };
  }
  const file = snapshotKnownRecord(value, MULTIPART_FILE_FIELDS);
  const filename = requiredString(file.filename, 1024);
  if (/[\r\n\0]/.test(filename)) throw validationFailure();
  const contentType = file.contentType === undefined
    ? 'application/octet-stream'
    : normalizeContentType(file.contentType);
  if (typeof file.bodyBase64 !== 'string' || !isCanonicalBase64(file.bodyBase64)) {
    throw validationFailure();
  }
  const bytes = base64ToBytes(file.bodyBase64);
  if (bytes.byteLength > 50 * 1024 * 1024) throw validationFailure();
  return { kind: 'file', filename, contentType, bytes };
}

function encodeMultipart(entries) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const boundary = `maitask-${randomHex(24)}`;
    const marker = encodeUtf8(boundary);
    if (entries.some(entry => entry.value.kind === 'file' && containsBytes(entry.value.bytes, marker))) continue;
    const chunks = [];
    let total = 0;
    const append = chunk => {
      const bytes = typeof chunk === 'string' ? encodeUtf8(chunk) : chunk;
      total += bytes.byteLength;
      if (total > 50 * 1024 * 1024) throw validationFailure();
      chunks.push(bytes);
    };
    for (const entry of entries) {
      append(`--${boundary}\r\n`);
      if (entry.value.kind === 'text') {
        append(`Content-Disposition: form-data; name="${escapeQuoted(entry.name)}"\r\n\r\n`);
        append(entry.value.value);
        append('\r\n');
      } else {
        const asciiName = asciiFilename(entry.value.filename);
        const encodedName = encodeURIComponent(entry.value.filename).replace(/['()*]/g, character =>
          `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        append(
          `Content-Disposition: form-data; name="${escapeQuoted(entry.name)}"; ` +
          `filename="${escapeQuoted(asciiName)}"; filename*=UTF-8''${encodedName}\r\n`
        );
        append(`Content-Type: ${entry.value.contentType}\r\n\r\n`);
        append(entry.value.bytes);
        append('\r\n');
      }
    }
    append(`--${boundary}--\r\n`);
    return { boundary, bytes: concatenateBytes(chunks, total) };
  }
  throw validationFailure();
}

function snapshotParameterRecord(value, _name) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  let total = 0;
  for (const [key, item] of Object.entries(record)) {
    if (!key || key.length > 1024 || /[\0]/.test(key)) throw validationFailure();
    const values = Array.isArray(item) ? snapshotArray(item) : [item];
    if (values.length === 0) throw validationFailure();
    const normalized = values.map(snapshotParameterValue);
    total += normalized.length;
    if (total > 1000) throw validationFailure();
    result[key] = Array.isArray(item) ? normalized : normalized[0];
  }
  return result;
}

function snapshotParameterValue(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw validationFailure();
}

function appendQuery(url, query) {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(item));
  }
  if (target.toString().length > 16_384) throw validationFailure();
  return target.toString();
}

function normalizeUrl(value, allowInsecureHttp, allowedHosts) {
  let url;
  try { url = new URL(value); } catch { throw validationFailure(); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw validationFailure();
  if (url.username || url.password || url.hash) throw validationFailure();
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || url.toString().length > 16_384) throw validationFailure();
  if (url.protocol === 'http:' && (!allowInsecureHttp || !isPrivateOrLocalHost(hostname))) {
    throw policyFailure();
  }
  if (allowedHosts && !allowedHosts.has(hostname)) throw policyFailure();
  return url.toString();
}

function normalizeAllowedHosts(value) {
  if (value === undefined) return null;
  const items = snapshotArray(value);
  if (items.length === 0 || items.length > 100) throw validationFailure();
  const result = new Set();
  for (const item of items) {
    if (typeof item !== 'string') throw validationFailure();
    const text = item.trim();
    if (!text || /[\/@?#]/.test(text)) throw validationFailure();
    let parsed;
    try {
      if (text.startsWith('[') && text.endsWith(']')) {
        parsed = new URL(`https://${text}/`);
      } else if (text.includes(':')) {
        parsed = new URL(`https://[${text}]/`);
      } else {
        parsed = new URL(`https://${text}/`);
      }
    } catch {
      throw validationFailure();
    }
    if (parsed.port || parsed.username || parsed.password || parsed.pathname !== '/') throw validationFailure();
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) throw validationFailure();
    result.add(host);
  }
  return result;
}

function retainCrossOriginHeaders(headers) {
  const result = Object.create(null);
  for (const [key, value] of Object.entries(headers)) {
    if (CROSS_ORIGIN_SAFE_HEADERS.has(key)) result[key] = value;
  }
  return result;
}

function setGeneratedContentType(headers, value) {
  if (hasOwn(headers, 'content-type')) return;
  headers['content-type'] = value;
}

function readContext(value) {
  if (value === undefined || value === null) return { secrets: Object.create(null), executionId: null };
  const record = snapshotOpenRecord(value);
  return {
    secrets: record.secrets === undefined ? Object.create(null) : snapshotSecrets(record.secrets),
    executionId: record.executionId === undefined ? null : requiredString(record.executionId, 256)
  };
}

function readSafeExecutionId(value) {
  try { return readContext(value).executionId; } catch { return null; }
}

function snapshotSecrets(value) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof item !== 'string' ||
        item.length === 0 || item.length > 16_384) {
      throw validationFailure();
    }
    result[key] = item;
  }
  return result;
}

function resolveSecret(name, optionSecrets, contextSecrets) {
  const value = hasOwn(optionSecrets, name)
    ? optionSecrets[name]
    : hasOwn(contextSecrets, name) ? contextSecrets[name] : null;
  if (typeof value !== 'string' || value.length === 0) throw secretUnavailableFailure();
  return value;
}

function requiredSecretName(value) {
  const name = requiredString(value, 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw validationFailure();
  return name;
}

function validateSecretHeaderValue(value) {
  if (/[\r\n\0]/.test(value)) throw validationFailure();
}

function canRetryFailure(failure, config, attempt) {
  if (!SAFE_RETRY_METHODS.has(config.method) || attempt >= config.retry.maxAttempts) return false;
  if (failure.code === 'HTTP_REQUEST_UPSTREAM') return true;
  return failure.code === 'HTTP_REQUEST_STATUS' && failure.status !== undefined &&
    config.retry.statuses.has(failure.status);
}

async function waitForRetry(retry, attempt, retryAfter, state) {
  let delay = retry.initialDelayMs * Math.pow(retry.backoffFactor, attempt - 1);
  delay = Math.min(retry.maxDelayMs, delay);
  if (retry.respectRetryAfter) {
    const parsed = parseRetryAfter(retryAfter);
    if (parsed !== null) delay = Math.min(retry.maxDelayMs, parsed);
  }
  if (retry.jitterRatio > 0 && delay > 0) {
    const spread = delay * retry.jitterRatio;
    delay = Math.max(0, delay - spread + Math.random() * spread * 2);
  }
  delay = Math.ceil(delay);
  const remaining = remainingTime(state);
  if (remaining <= 0 || delay >= remaining) {
    if (remaining > 0) await sleep(remaining);
    throw timeoutFailure();
  }
  if (delay > 0) await sleep(delay);
}

function parseRetryAfter(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function remainingTime(state) {
  return Math.max(0, state.deadlineAt - Date.now());
}

function classifyTransportError(error, aborted = false) {
  if (error instanceof HttpRequestFailure) return error;
  if (aborted || error && error.name === 'AbortError') return timeoutFailure();
  const message = error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('response exceeds') || message.includes('response byte limit')) {
    return responseTooLargeFailure();
  }
  if (message.includes('timed out') || message.includes('timeout')) return timeoutFailure();
  return upstreamFailure();
}

function normalizeFailure(error) {
  const failure = error instanceof HttpRequestFailure ? error : upstreamFailure();
  return {
    message: failure.message,
    code: failure.code,
    type: failure.type,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retriable === undefined ? {} : { retriable: failure.retriable })
  };
}

function snapshotKnownRecord(value, allowedFields) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!allowedFields.has(key) || !hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotOpenRecord(value) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function inspectRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validationFailure();
  try {
    const prototype = Object.getPrototypeOf(value);
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
      throw validationFailure();
    }
    return { descriptors };
  } catch (error) {
    if (error instanceof HttpRequestFailure) throw error;
    throw validationFailure();
  }
}

function snapshotArray(value) {
  if (!Array.isArray(value)) throw validationFailure();
  let prototype;
  let symbols;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw validationFailure();
  }
  if (prototype !== Array.prototype || symbols.length > 0) throw validationFailure();
  const length = descriptors.length && descriptors.length.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) throw validationFailure();
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !hasOwn(descriptor, 'value')) throw validationFailure();
    result.push(descriptor.value);
  }
  if (Object.keys(descriptors).some(key => key !== 'length' && !/^\d+$/.test(key))) {
    throw validationFailure();
  }
  return result;
}

function snapshotJson(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationFailure();
    return value;
  }
  if (typeof value !== 'object' || depth > 50 || seen.has(value)) throw validationFailure();
  seen.add(value);
  try {
    if (Array.isArray(value)) return snapshotArray(value).map(item => snapshotJson(item, seen, depth + 1));
    const record = snapshotOpenRecord(value);
    const result = Object.create(null);
    for (const [key, item] of Object.entries(record)) result[key] = snapshotJson(item, seen, depth + 1);
    return result;
  } finally {
    seen.delete(value);
  }
}

function snapshotIntegerArray(value, min, max, maxLength) {
  const items = snapshotArray(value);
  if (items.length > maxLength) throw validationFailure();
  return items.map(item => {
    if (!Number.isInteger(item) || item < min || item > max) throw validationFailure();
    return item;
  });
}

function normalizeHeaderName(value) {
  if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/.test(value)) {
    throw validationFailure();
  }
  return value.toLowerCase();
}

function normalizeContentType(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n\0]/.test(value) || !value.includes('/')) {
    throw validationFailure();
  }
  return value.trim();
}

function normalizeResponseStatus(value) {
  if (!Number.isInteger(value) || value < 100 || value > 599) throw upstreamFailure();
  return value;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw validationFailure();
  return value;
}

function tightenInteger(value, ceiling, min, max) {
  const normalized = boundedInteger(value, ceiling, min, max);
  return Math.min(normalized, ceiling);
}

function boundedNumber(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw validationFailure();
  }
  return value;
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validationFailure();
  return value;
}

function optionalEnum(value, allowed, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) throw validationFailure();
  return value;
}

function requiredString(value, maxLength) {
  if (typeof value !== 'string') throw validationFailure();
  const result = value.trim();
  if (!result || result.length > maxLength || /\0/.test(result)) throw validationFailure();
  return result;
}

function validateMultipartName(value) {
  if (!value || value.length > 256 || /[\r\n\0]/.test(value)) throw validationFailure();
}

function escapeQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function asciiFilename(value) {
  const result = value.replace(/[^\x20-\x7e]/g, '_');
  return result || 'file';
}

function randomHex(bytes) {
  const data = new Uint8Array(bytes);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(data);
  } else {
    for (let index = 0; index < data.length; index += 1) data[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(data, item => item.toString(16).padStart(2, '0')).join('');
}

function containsBytes(haystack, needle) {
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) return false;
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function concatenateBytes(chunks, total) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  try { return bytesToBase64(base64ToBytes(value)) === value; } catch { return false; }
}

function base64ToBytes(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  if (typeof atob !== 'function') throw validationFailure();
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  if (typeof btoa !== 'function') throw upstreamFailure();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function encodeUtf8Base64(value) {
  return bytesToBase64(encodeUtf8(value));
}

function encodeUtf8(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8Fatal(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    let codePoint;
    let length;
    let minimum;
    if (first <= 0x7f) {
      codePoint = first;
      length = 1;
      minimum = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      length = 2;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      length = 3;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      length = 4;
      minimum = 0x10000;
    } else {
      throw responseParseFailure();
    }
    if (index + length > bytes.length) throw responseParseFailure();
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) throw responseParseFailure();
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (codePoint < minimum || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw responseParseFailure();
    }
    if (codePoint <= 0xffff) {
      result += String.fromCharCode(codePoint);
    } else {
      const adjusted = codePoint - 0x10000;
      result += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
    index += length;
  }
  return result;
}

function cloneRecord(value) {
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) result[key] = item;
  return result;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasRuntimeHttpOperation() {
  return typeof globalThis.Deno !== 'undefined' && globalThis.Deno && globalThis.Deno.core &&
    globalThis.Deno.core.ops && typeof globalThis.Deno.core.ops.op_http_request === 'function';
}

function ensureTransport() {
  if (!hasRuntimeHttpOperation() && typeof fetch !== 'function') throw upstreamFailure();
  if (typeof URL !== 'function' || typeof AbortController !== 'function') {
    throw upstreamFailure();
  }
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':') && (host === '::' || host === '::1' || host.startsWith('fc') ||
      host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') ||
      host.startsWith('fea') || host.startsWith('feb'))) {
    return true;
  }
  if (host.startsWith('::ffff:')) return isPrivateOrLocalHost(host.slice(7));
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function validationFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_VALIDATION',
    'Invalid HTTP request configuration.',
    'ValidationError',
    { retriable: false }
  );
}

function secretUnavailableFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_SECRET_UNAVAILABLE',
    'A required HTTP request secret is unavailable.',
    'SecretUnavailableError',
    { retriable: false }
  );
}

function policyFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_POLICY',
    'HTTP request policy denied the target.',
    'PolicyError',
    { retriable: false }
  );
}

function timeoutFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_TIMEOUT',
    'HTTP request exceeded the total deadline.',
    'TimeoutError',
    { retriable: false }
  );
}

function responseTooLargeFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_RESPONSE_TOO_LARGE',
    'HTTP response exceeded the configured size limit.',
    'ResponseLimitError',
    { retriable: false }
  );
}

function redirectFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_REDIRECT',
    'HTTP redirect policy rejected the response.',
    'RedirectError',
    { retriable: false }
  );
}

function statusFailure(status, retriable) {
  return new HttpRequestFailure(
    'HTTP_REQUEST_STATUS',
    'HTTP response status was not accepted.',
    'HttpStatusError',
    { status, retriable }
  );
}

function responseParseFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_RESPONSE_PARSE',
    'HTTP response could not be parsed as the requested representation.',
    'ResponseParseError',
    { retriable: false }
  );
}

function upstreamFailure() {
  return new HttpRequestFailure(
    'HTTP_REQUEST_UPSTREAM',
    'HTTP transport failed.',
    'UpstreamError',
    { retriable: true }
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
