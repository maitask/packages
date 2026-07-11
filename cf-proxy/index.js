/**
 * @maitask/cf-proxy
 * Validated read-only proxy transport for GitHub and container registries.
 */

const PACKAGE_NAME = '@maitask/cf-proxy';
const PACKAGE_VERSION = '0.1.0';

const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io',
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com'
]);

const DEFAULT_DOCKER_REGISTRY_HOSTS = Object.freeze([
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io'
]);

const DEFAULT_ALLOWED_AUTH_HOSTS = Object.freeze([
  'auth.docker.io',
  'quay.io',
  'gcr.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry.k8s.io'
]);

const INPUT_FIELDS = new Set(['url', 'method', 'headers', 'config']);
const CONFIG_FIELDS = new Set([
  'allowedHosts',
  'allowedAuthHosts',
  'dockerRegistryHosts',
  'restrictPaths',
  'allowedPaths',
  'maxRedirects',
  'timeoutMs',
  'maxResponseBytes',
  'allowPrivateHosts'
]);
const MANAGED_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);
const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization'
]);
const FILTERED_RESPONSE_HEADERS = new Set([
  'authentication-info',
  'connection',
  'keep-alive',
  'location',
  'proxy-authenticate',
  'set-cookie',
  'set-cookie2',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'www-authenticate'
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

class ProxyFailure extends Error {
  constructor(code, message, type) {
    super(message);
    this.code = code;
    this.type = type;
  }
}

async function execute(input = {}, options = {}, _context = {}) {
  try {
    ensureTransport();
    assertEmptyOptions(options);
    const cfg = buildConfig(input);
    const target = parseAndValidateUrl(cfg.url, cfg, 'content');
    const state = {
      deadlineAt: Date.now() + cfg.timeoutMs,
      cfg
    };
    const transportResult = await sendWithDockerAuthIfNeeded(target, cfg, state);
    const response = transportResult.response;

    return {
      success: true,
      data: {
        status: response.status,
        statusText: statusTextFor(response.status),
        ok: response.status >= 200 && response.status < 300,
        headers: filterResponseHeaders(response.headers),
        bodyBase64: response.bodyBase64,
        bodyEncoding: 'base64',
        bodyBytes: response.bodyBytes,
        isDockerRequest: cfg.dockerRegistryHosts.includes(target.hostname)
      },
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        redirects: transportResult.redirects,
        registryAuthenticated: transportResult.registryAuthenticated,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    const failure = normalizeFailure(error);
    return {
      success: false,
      error: failure,
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        timestamp: new Date().toISOString()
      }
    };
  }
}

function buildConfig(rawInput) {
  const input = snapshotRecord(rawInput, 'input', INPUT_FIELDS);
  const config = snapshotRecord(input.config ?? {}, 'config', CONFIG_FIELDS);
  const url = requiredString(input.url, 'url');
  const method = optionalString(input.method, 'method', 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    throw validationFailure();
  }

  const allowedHosts = normalizeHostList(
    config.allowedHosts,
    'config.allowedHosts',
    DEFAULT_ALLOWED_HOSTS
  );
  const allowedAuthHosts = normalizeHostList(
    config.allowedAuthHosts,
    'config.allowedAuthHosts',
    DEFAULT_ALLOWED_AUTH_HOSTS
  );
  const dockerRegistryHosts = config.dockerRegistryHosts === undefined
    ? DEFAULT_DOCKER_REGISTRY_HOSTS.filter(host => allowedHosts.includes(host))
    : normalizeHostList(config.dockerRegistryHosts, 'config.dockerRegistryHosts', []);
  if (dockerRegistryHosts.some(host => !allowedHosts.includes(host))) throw validationFailure();

  return {
    url,
    method,
    headers: normalizeRequestHeaders(input.headers),
    allowedHosts,
    allowedAuthHosts,
    dockerRegistryHosts,
    restrictPaths: optionalBoolean(config.restrictPaths, false),
    allowedPaths: normalizePathList(config.allowedPaths),
    maxRedirects: boundedInteger(config.maxRedirects, 5, 0, 10),
    timeoutMs: boundedInteger(config.timeoutMs, 30000, 10, 120000),
    maxResponseBytes: boundedInteger(
      config.maxResponseBytes,
      8 * 1024 * 1024,
      1,
      50 * 1024 * 1024
    ),
    allowPrivateHosts: optionalBoolean(config.allowPrivateHosts, false)
  };
}

function assertEmptyOptions(options) {
  if (options === undefined || options === null) return;
  snapshotRecord(options, 'options', new Set());
}

function snapshotRecord(value, _label, allowedFields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationFailure();
  }

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

  if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
    throw validationFailure();
  }

  const result = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedFields.has(key) || !Object.hasOwn(descriptor, 'value')) {
      throw validationFailure();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotStringArray(value, fallback) {
  if (value === undefined) return [...fallback];
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
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) throw validationFailure();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 1000) throw validationFailure();

  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
      throw validationFailure();
    }
    result.push(descriptor.value);
  }

  const allowedKeys = new Set(['length', ...result.map((_entry, index) => String(index))]);
  if (Object.keys(descriptors).some(key => !allowedKeys.has(key))) throw validationFailure();
  return result;
}

function normalizeHostList(value, label, fallback) {
  const entries = snapshotStringArray(value, fallback);
  if (entries.length === 0) throw validationFailure();
  const normalized = entries.map(entry => normalizeHost(entry, label));
  return [...new Set(normalized)];
}

function normalizeHost(value, _label) {
  const text = requiredString(value, 'host').toLowerCase();
  if (text.includes('/') || text.includes('?') || text.includes('#') || text.includes('@')) {
    throw validationFailure();
  }

  let parsed;
  try {
    parsed = new URL(`http://${text}`);
  } catch {
    throw validationFailure();
  }

  if (parsed.port || parsed.username || parsed.password || parsed.pathname !== '/') {
    throw validationFailure();
  }
  return parsed.hostname.toLowerCase();
}

function normalizePathList(value) {
  const entries = snapshotStringArray(value, ['/library']);
  if (entries.length === 0) throw validationFailure();
  return [...new Set(entries.map(entry => {
    const text = requiredString(entry, 'path');
    if (text.includes('?') || text.includes('#')) throw validationFailure();
    const path = text.startsWith('/') ? text : `/${text}`;
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  }))];
}

function normalizeRequestHeaders(value) {
  if (value === undefined) return {};
  const record = snapshotOpenRecord(value);
  const headers = {};
  const seen = new Set();

  for (const [name, rawValue] of Object.entries(record)) {
    if (!HEADER_NAME_PATTERN.test(name) || typeof rawValue !== 'string') {
      throw validationFailure();
    }
    const lower = name.toLowerCase();
    if (seen.has(lower) || MANAGED_REQUEST_HEADERS.has(lower) || /[\r\n]/.test(rawValue)) {
      throw validationFailure();
    }
    seen.add(lower);
    headers[name] = rawValue;
  }
  return headers;
}

function snapshotOpenRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw validationFailure();
  }
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
  if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
    throw validationFailure();
  }
  const result = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function parseAndValidateUrl(value, cfg, purpose) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw validationFailure();
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username || parsed.password || parsed.hash) {
    throw validationFailure();
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = purpose === 'auth' ? cfg.allowedAuthHosts : cfg.allowedHosts;
  if (!allowedHosts.includes(hostname)) {
    throw purpose === 'auth' ? authFailure() : deniedFailure('Target host is not allowed.');
  }
  if (!cfg.allowPrivateHosts && isPrivateOrLocalHost(hostname)) {
    throw purpose === 'auth'
      ? authFailure()
      : deniedFailure('Private or local targets require explicit access.');
  }

  if (purpose === 'content' && cfg.restrictPaths) {
    const pathAllowed = cfg.allowedPaths.some(prefix =>
      parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    );
    if (!pathAllowed) throw deniedFailure('Target path is not allowed.');
  }

  return {
    href: parsed.href,
    hostname,
    origin: parsed.origin,
    pathname: parsed.pathname
  };
}

async function sendWithDockerAuthIfNeeded(target, cfg, state) {
  const dockerRequest = cfg.dockerRegistryHosts.includes(target.hostname);
  const callerHeaders = { ...cfg.headers };
  let response = await request(target.href, {
    method: cfg.method,
    headers: callerHeaders
  }, state, cfg.maxResponseBytes);

  if (!dockerRequest || response.status !== 401) {
    const redirected = await followRedirects(response, target, cfg.method, callerHeaders, cfg, state, 'content');
    return { ...redirected, registryAuthenticated: false };
  }

  const challengeHeader = getHeader(response.headers, 'www-authenticate');
  const challenge = parseBearerChallenge(challengeHeader);
  const token = await requestDockerToken(challenge, cfg, state);
  const authenticatedHeaders = replaceAuthorization(callerHeaders, `Bearer ${token}`);

  response = await request(target.href, {
    method: cfg.method,
    headers: authenticatedHeaders
  }, state, cfg.maxResponseBytes);
  if (response.status === 401) throw authFailure();

  const redirected = await followRedirects(
    response,
    target,
    cfg.method,
    authenticatedHeaders,
    cfg,
    state,
    'content'
  );
  return { ...redirected, registryAuthenticated: true };
}

async function followRedirects(response, initialTarget, method, initialHeaders, cfg, state, purpose) {
  let currentResponse = response;
  let currentTarget = initialTarget;
  let currentHeaders = { ...initialHeaders };
  let redirects = 0;

  while (isRedirectStatus(currentResponse.status)) {
    if (redirects >= cfg.maxRedirects) throw redirectFailure();
    const location = getHeader(currentResponse.headers, 'location');
    if (!location) throw redirectFailure();

    let nextUrl;
    try {
      nextUrl = new URL(location, currentTarget.href).href;
    } catch {
      throw redirectFailure();
    }

    let nextTarget;
    try {
      nextTarget = parseAndValidateUrl(nextUrl, cfg, purpose);
    } catch (error) {
      if (error instanceof ProxyFailure && error.code === 'CF_PROXY_AUTH') throw error;
      throw redirectFailure();
    }

    if (nextTarget.origin !== currentTarget.origin) {
      currentHeaders = stripCrossOriginCredentials(currentHeaders);
    }

    currentResponse = await request(nextTarget.href, {
      method,
      headers: currentHeaders
    }, state, purpose === 'auth' ? Math.min(cfg.maxResponseBytes, 64 * 1024) : cfg.maxResponseBytes);
    currentTarget = nextTarget;
    redirects += 1;
  }

  return { response: currentResponse, redirects };
}

function parseBearerChallenge(header) {
  if (typeof header !== 'string') throw authFailure();
  const match = /^\s*([^\s]+)\s+(.+)\s*$/.exec(header);
  if (!match || match[1].toLowerCase() !== 'bearer') throw authFailure();

  const source = match[2];
  const parameters = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    const keyMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(source.slice(index));
    if (!keyMatch) throw authFailure();
    const key = keyMatch[0].toLowerCase();
    index += keyMatch[0].length;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] !== '=') throw authFailure();
    index += 1;
    while (index < source.length && /\s/.test(source[index])) index += 1;

    let value = '';
    if (source[index] === '"') {
      index += 1;
      let closed = false;
      while (index < source.length) {
        const char = source[index];
        index += 1;
        if (char === '"') {
          closed = true;
          break;
        }
        if (char === '\\') {
          if (index >= source.length) throw authFailure();
          value += source[index];
          index += 1;
        } else {
          value += char;
        }
      }
      if (!closed) throw authFailure();
    } else {
      const valueMatch = /^[^\s,]+/.exec(source.slice(index));
      if (!valueMatch) throw authFailure();
      value = valueMatch[0];
      index += value.length;
    }

    if (Object.hasOwn(parameters, key)) throw authFailure();
    parameters[key] = value;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index < source.length && source[index] !== ',') throw authFailure();
  }

  if (!parameters.realm) throw authFailure();
  return {
    realm: parameters.realm,
    service: parameters.service,
    scope: parameters.scope
  };
}

async function requestDockerToken(challenge, cfg, state) {
  let tokenUrl;
  try {
    tokenUrl = new URL(challenge.realm);
  } catch {
    throw authFailure();
  }
  if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set('scope', challenge.scope);

  let target;
  try {
    target = parseAndValidateUrl(tokenUrl.href, cfg, 'auth');
  } catch {
    throw authFailure();
  }

  const cleanHeaders = { Accept: 'application/json' };
  const initial = await request(target.href, {
    method: 'GET',
    headers: cleanHeaders
  }, state, Math.min(cfg.maxResponseBytes, 64 * 1024));
  const redirected = await followRedirects(initial, target, 'GET', cleanHeaders, cfg, state, 'auth');
  if (redirected.response.status < 200 || redirected.response.status >= 300) throw authFailure();

  let payload;
  try {
    payload = JSON.parse(decodeBodyText(redirected.response));
  } catch {
    throw authFailure();
  }
  const record = snapshotOpenRecord(payload);
  const token = record.token ?? record.access_token;
  if (typeof token !== 'string' || token.trim().length === 0 || token.length > 16384) {
    throw authFailure();
  }
  return token;
}

async function request(url, init, state, maxResponseBytes) {
  const remainingMs = state.deadlineAt - Date.now();
  if (remainingMs <= 0) throw timeoutFailure();

  if (globalThis.Deno?.core?.ops?.op_http_request) {
    return requestViaRuntimeOp(url, init, remainingMs, maxResponseBytes);
  }
  return requestViaFetch(url, init, remainingMs, maxResponseBytes);
}

async function requestViaRuntimeOp(url, init, timeoutMs, maxResponseBytes) {
  let timer;
  try {
    const operation = Deno.core.ops.op_http_request(url, {
      ...init,
      redirect: 'manual',
      timeoutMs,
      maxResponseBytes
    });
    const raw = await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutFailure()), timeoutMs);
      })
    ]);
    return normalizeRuntimeResponse(raw, maxResponseBytes);
  } catch (error) {
    if (error instanceof ProxyFailure) throw error;
    throw upstreamFailure();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requestViaFetch(url, init, timeoutMs, maxResponseBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      redirect: 'manual',
      signal: controller.signal
    });
    const body = await readFetchBody(response, maxResponseBytes, controller);
    return {
      status: response.status,
      headers: normalizeResponseHeaders(Object.fromEntries(response.headers.entries())),
      bodyBase64: bytesToBase64(body),
      bodyBytes: body.byteLength
    };
  } catch (error) {
    if (error instanceof ProxyFailure) throw error;
    if (error && error.name === 'AbortError') throw timeoutFailure();
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function readFetchBody(response, maxResponseBytes, controller) {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxResponseBytes) {
      controller.abort();
      throw responseTooLargeFailure();
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        controller.abort();
        throw responseTooLargeFailure();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function normalizeRuntimeResponse(raw, maxResponseBytes) {
  try {
    const response = snapshotRecord(
      raw,
      'runtime response',
      new Set(['status', 'headers', 'bodyBase64', 'bodyBytes'])
    );
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
      throw upstreamFailure();
    }
    if (typeof response.bodyBase64 !== 'string' || !isCanonicalBase64(response.bodyBase64)) {
      throw upstreamFailure();
    }
    const bodyBytes = base64ToBytes(response.bodyBase64).byteLength;
    if (bodyBytes > maxResponseBytes) throw responseTooLargeFailure();
    if (response.bodyBytes !== undefined && response.bodyBytes !== bodyBytes) throw upstreamFailure();
    return {
      status: response.status,
      headers: normalizeResponseHeaders(response.headers),
      bodyBase64: response.bodyBase64,
      bodyBytes
    };
  } catch (error) {
    if (error instanceof ProxyFailure && error.code === 'CF_PROXY_RESPONSE_TOO_LARGE') throw error;
    throw upstreamFailure();
  }
}

function normalizeResponseHeaders(value) {
  if (value === undefined || value === null) return {};
  const record = snapshotOpenRecord(value);
  const headers = {};
  for (const [name, rawValue] of Object.entries(record)) {
    if (!HEADER_NAME_PATTERN.test(name) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) {
      continue;
    }
    headers[name.toLowerCase()] = rawValue;
  }
  return headers;
}

function filterResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!FILTERED_RESPONSE_HEADERS.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function replaceAuthorization(headers, value) {
  const result = {};
  for (const [key, entry] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'authorization') result[key] = entry;
  }
  result.Authorization = value;
  return result;
}

function stripCrossOriginCredentials(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_REQUEST_HEADERS.has(key.toLowerCase())) result[key] = value;
  }
  return result;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') ||
      host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
    return true;
  }
  if (host.startsWith('::ffff:')) return isPrivateOrLocalHost(host.slice(7));
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function requiredString(value, _field) {
  if (typeof value !== 'string') throw validationFailure();
  const text = value.trim();
  if (!text || text.length > 8192) throw validationFailure();
  return text;
}

function optionalString(value, field, fallback) {
  return value === undefined ? fallback : requiredString(value, field);
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validationFailure();
  return value;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw validationFailure();
  return value;
}

function statusTextFor(status) {
  const values = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return values[status] || '';
}

function decodeBodyText(response) {
  return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(response.bodyBase64));
}

function isCanonicalBase64(value) {
  try {
    return bytesToBase64(base64ToBytes(value)) === value;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validationFailure() {
  return new ProxyFailure('CF_PROXY_VALIDATION', 'Invalid CF proxy request.', 'ValidationError');
}

function deniedFailure(message) {
  return new ProxyFailure('CF_PROXY_DENIED', message, 'PolicyError');
}

function timeoutFailure() {
  return new ProxyFailure('CF_PROXY_TIMEOUT', 'CF proxy request timed out.', 'TimeoutError');
}

function responseTooLargeFailure() {
  return new ProxyFailure(
    'CF_PROXY_RESPONSE_TOO_LARGE',
    'CF proxy response exceeded the configured size limit.',
    'ResponseLimitError'
  );
}

function redirectFailure() {
  return new ProxyFailure(
    'CF_PROXY_REDIRECT',
    'CF proxy redirect policy rejected the response.',
    'RedirectError'
  );
}

function authFailure() {
  return new ProxyFailure(
    'CF_PROXY_AUTH',
    'CF proxy registry authentication failed.',
    'AuthenticationError'
  );
}

function upstreamFailure() {
  return new ProxyFailure(
    'CF_PROXY_UPSTREAM',
    'CF proxy upstream request failed.',
    'UpstreamError'
  );
}

function normalizeFailure(error) {
  if (error instanceof ProxyFailure) {
    return {
      message: error.message,
      code: error.code,
      type: error.type
    };
  }
  return {
    message: 'CF proxy upstream request failed.',
    code: 'CF_PROXY_UPSTREAM',
    type: 'UpstreamError'
  };
}

function ensureTransport() {
  if (globalThis.Deno?.core?.ops?.op_http_request) return;
  if (typeof fetch !== 'function') throw upstreamFailure();
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;
