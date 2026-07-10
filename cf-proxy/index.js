/**
 * @maitask/cf-proxy
 * Cloudflare Worker-style proxy helper for GitHub and container registries.
 */

const PACKAGE_NAME = '@maitask/cf-proxy';
const PACKAGE_VERSION = '0.1.0';

const DEFAULT_ALLOWED_HOSTS = [
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
];

const DOCKER_HOSTS = new Set([
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io'
]);

async function execute(input = {}, options = {}, context = {}) {
  try {
    ensureFetch();

    const cfg = buildConfig(input);
    const target = parseTargetUrl(cfg.url);
    validateTarget(target, cfg);

    const response = await sendWithDockerAuthIfNeeded(target, cfg);

    return {
      success: true,
      data: {
        status: response.status,
        statusText: response.ok ? 'OK' : 'Error',
        headers: response.headers,
        bodyBase64: response.bodyBase64,
        bodyEncoding: 'base64',
        bodyBytes: response.bodyBytes,
        targetDomain: target.domain,
        targetPath: target.path,
        isDockerRequest: DOCKER_HOSTS.has(target.domain),
        isS3: target.domain.includes('amazonaws.com')
      },
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        redirects: response.redirectCount,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error?.message || 'Unknown proxy error',
        code: 'CF_PROXY_ERROR',
        type: error?.name || 'ProxyError'
      },
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        timestamp: new Date().toISOString()
      }
    };
  }
}

function buildConfig(input) {
  const config = input.config || {};
  const url = asNonEmptyString(input.url);
  if (!url) {
    throw new Error('url is required');
  }

  return {
    url,
    method: String(input.method || 'GET').toUpperCase(),
    headers: sanitizeHeaders(input.headers),
    allowedHosts: Array.isArray(config.allowedHosts) && config.allowedHosts.length ? config.allowedHosts : DEFAULT_ALLOWED_HOSTS,
    restrictPaths: Boolean(config.restrictPaths),
    allowedPaths: Array.isArray(config.allowedPaths) && config.allowedPaths.length ? config.allowedPaths : ['library'],
    maxRedirects: toBoundedInt(config.maxRedirects, 0, 20, 5),
    allowPrivateHosts: config.allowPrivateHosts === true
  };
}

function parseTargetUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  return {
    href: parsed.href,
    domain: parsed.hostname,
    path: parsed.pathname.replace(/^\//, ''),
    origin: parsed.origin,
    protocol: parsed.protocol
  };
}

function validateTarget(target, cfg) {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('Target must use HTTP or HTTPS');
  }
  if (!cfg.allowedHosts.includes(target.domain)) {
    throw new Error('Target domain is not allowed');
  }
  if (!cfg.allowPrivateHosts && isPrivateOrLocalHost(target.domain)) {
    throw new Error('Private or local targets require allowPrivateHosts');
  }

  if (!cfg.restrictPaths) return;

  const pathLower = target.path.toLowerCase();
  const allowed = cfg.allowedPaths.some((entry) => pathLower.includes(String(entry).toLowerCase()));
  if (!allowed) {
    throw new Error(`Path ${target.path || '/'} is not allowed`);
  }
}

async function sendWithDockerAuthIfNeeded(target, cfg) {
  const isDockerRequest = DOCKER_HOSTS.has(target.domain);
  const baseHeaders = {
    ...cfg.headers,
    Host: target.domain
  };

  const first = await request(target.href, {
    method: cfg.method,
    headers: withS3Headers(baseHeaders, target.domain)
  });

  if (!isDockerRequest) {
    return processRedirects(first, target, cfg, withS3Headers(baseHeaders, target.domain), 0);
  }

  if (first.status === 401) {
    const authHeader = first.headers['www-authenticate'] || first.headers['WWW-Authenticate'];
    const token = await requestDockerToken(authHeader);
    if (token) {
      const authed = await request(target.href, {
        method: cfg.method,
        headers: withS3Headers({
          ...baseHeaders,
          Authorization: `Bearer ${token}`
        }, target.domain)
      });
      return processRedirects(authed, target, cfg, withS3Headers(baseHeaders, target.domain), 0);
    }
  }

  return processRedirects(first, target, cfg, withS3Headers(baseHeaders, target.domain), 0);
}

async function processRedirects(response, initialTarget, cfg, headers, redirectCount) {
  let current = response;
  let currentTarget = initialTarget;
  let redirects = redirectCount;

  while (isRedirectStatus(current.status) && redirects < cfg.maxRedirects) {
    const nextUrl = current.headers.location || current.headers.Location;
    if (!nextUrl) break;

    const nextTarget = parseTargetUrl(new URL(nextUrl, currentTarget.href).href);
    validateTarget(nextTarget, cfg);
    const nextHeaders = nextTarget.origin === currentTarget.origin
      ? { ...headers }
      : stripCrossOriginCredentials(headers);
    current = await request(nextTarget.href, {
      method: 'GET',
      headers: withS3Headers({ ...nextHeaders, Host: nextTarget.domain }, nextTarget.domain)
    });
    currentTarget = nextTarget;
    redirects += 1;
  }

  if (isRedirectStatus(current.status) && redirects >= cfg.maxRedirects) {
    throw new Error(`Max redirects (${cfg.maxRedirects}) exceeded`);
  }

  return {
    ...current,
    redirectCount: redirects
  };
}

async function requestDockerToken(wwwAuthHeader) {
  if (!wwwAuthHeader) return null;

  const match = wwwAuthHeader.match(/Bearer\s+realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/i);
  if (!match) return null;

  const [, realm, service, scope] = match;
  const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`;
  const tokenRes = await request(tokenUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!tokenRes.ok) return null;

  let json;
  try {
    json = JSON.parse(decodeBodyText(tokenRes) || '{}');
  } catch {
    return null;
  }

  return json.token || json.access_token || null;
}

function withS3Headers(headers, domain) {
  if (!domain.includes('amazonaws.com')) {
    return headers;
  }

  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return {
    ...headers,
    'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'x-amz-date': now
  };
}

async function request(url, init) {
  if (globalThis.Deno?.core?.ops?.op_http_request) {
    const denoRes = await Deno.core.ops.op_http_request(url, init);
    return {
      ok: Boolean(denoRes.ok),
      status: Number(denoRes.status),
      headers: denoRes.headers || {},
      bodyBase64: denoRes.bodyBase64 || encodeUtf8Base64(denoRes.body || ''),
      bodyBytes: Number(denoRes.bodyBytes) || decodeBase64Length(denoRes.bodyBase64 || encodeUtf8Base64(denoRes.body || ''))
    };
  }

  const res = await fetch(url, { ...init, redirect: 'manual' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    bodyBase64: bytesToBase64(bytes),
    bodyBytes: bytes.byteLength
  };
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function stripCrossOriginCredentials(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') continue;
    result[key] = value;
  }
  return result;
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function decodeBodyText(response) {
  return new TextDecoder().decode(base64ToBytes(response.bodyBase64 || ''));
}

function encodeUtf8Base64(value) {
  return bytesToBase64(new TextEncoder().encode(String(value)));
}

function decodeBase64Length(value) {
  return base64ToBytes(value || '').byteLength;
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

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    result[String(key)] = String(value);
  }
  return result;
}

function toBoundedInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function asNonEmptyString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch API is unavailable. Node.js 18+ is required.');
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
