/**
 * @maitask/s3-storage
 * S3-compatible object storage operations via presigned URLs
 *
 * @version 0.1.1
 * @license MIT
 */

const PACKAGE_NAME = '@maitask/s3-storage';
const PACKAGE_VERSION = '0.1.1';
const OPERATIONS = new Set(['list', 'upload', 'download', 'delete']);
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

async function execute(input, options = {}, context = {}) {
  try {
    const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const payload = asObject(input);
    const operation = normalizeOperation(payload.operation);
    const timeoutMs = readTimeout(payload.timeoutMs ?? safeOptions.timeoutMs);

    const result = await runWithPresignedUrl(operation, payload, safeOptions, timeoutMs);

    return {
      success: true,
      data: result,
      metadata: {
        package: PACKAGE_NAME,
        operation,
        timestamp: new Date().toISOString(),
        version: PACKAGE_VERSION
      }
    };
  } catch (error) {
    return buildError(error, 'S3_STORAGE_ERROR', 'S3StorageError');
  }
}

if (typeof module !== 'undefined') {
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

function validatePresignedUrl(rawUrl, options = {}) {
  const parsed = new URL(readRequiredString(rawUrl, 'presignedUrl'));
  if (parsed.username || parsed.password) {
    throw new Error('presignedUrl must not embed credentials');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && options?.allowInsecureHttp === true)) {
    throw new Error('presignedUrl must use https');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const allowPrivate = options?.allowPrivateHosts === true || options?.allowPrivateHost === true;
  if (!allowPrivate && isBlockedHost(host)) {
    throw new Error('presignedUrl host is not permitted');
  }
  return parsed.toString();
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    !host ||
    host === 'localhost' ||
    host === 'local' ||
    host === 'internal' ||
    host === 'localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localdomain')
  ) {
    return true;
  }
  if (host.includes(':')) {
    const clean = host.split('%')[0];
    const hextets = parseIpv6Hextets(clean);
    if (!hextets) return true;
    const allZero = hextets.every(part => part === 0);
    const isLoopback = hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1;
    if (allZero || isLoopback) return true;
    if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
    if (hextets.slice(0, 5).every(part => part === 0) && hextets[5] === 0xffff) return true; // ::ffff:0:0/96
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
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

async function runWithPresignedUrl(operation, payload, options, timeoutMs) {
  const url = validatePresignedUrl(payload.presignedUrl, options);

  if (operation === 'list') {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: asHeaders(payload.headers),
      timeoutMs
    });
    await ensureOk(response);
    const xml = await readBoundedText(response, MAX_DOWNLOAD_BYTES);
    return {
      mode: 'presigned-url',
      ...parseS3ListXml(xml),
      status: response.status
    };
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

    const content = await readBoundedText(response, MAX_DOWNLOAD_BYTES);
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

function parseS3ListXml(xml) {
  const contents = [];
  const contentBlocks = String(xml || '').match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  for (const block of contentBlocks) {
    const key = extractXmlTag(block, 'Key');
    const size = Number(extractXmlTag(block, 'Size') || 0);
    const lastModified = extractXmlTag(block, 'LastModified');
    const etag = extractXmlTag(block, 'ETag');
    if (key !== null) {
      contents.push({
        key,
        size: Number.isFinite(size) ? size : 0,
        lastModified,
        etag: etag ? etag.replace(/^"|"$/g, '') : null
      });
    }
  }
  const prefix = extractXmlTag(xml, 'Prefix') || '';
  const isTruncated = extractXmlTag(xml, 'IsTruncated') === 'true';
  const nextContinuationToken = extractXmlTag(xml, 'NextContinuationToken') || null;
  return {
    prefix,
    keyCount: contents.length,
    isTruncated,
    nextContinuationToken,
    objects: contents
  };
}

function extractXmlTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return null;
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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

async function fetchWithTimeout(url, { method, headers, body, timeoutMs }) {
  const runtimeFetch = usesMaitaskRuntimeFetch();
  const controller = runtimeFetch ? null : new AbortController();
  const timer = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchInit = {
      method,
      headers,
      body,
      redirect: 'manual',
      timeoutMs
    };
    if (runtimeFetch) {
      fetchInit.maxResponseBytes = MAX_DOWNLOAD_BYTES;
    } else {
      fetchInit.signal = controller.signal;
    }
    const response = await fetch(url, fetchInit);
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      throw new Error('Presigned URL redirects are not permitted');
    }
    return response;
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

async function readBoundedText(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (response?.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch {}
    }
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }
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
          throw new Error(`Response exceeds ${maxBytes} byte limit`);
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
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }
  return text || '';
}

async function ensureOk(response) {
  if (response.ok) return;
  const text = await readBoundedText(response, 65536).catch(() => '');
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
  const safeMessage = String(error?.message || 'Unknown error').replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  return {
    success: false,
    error: {
      message: safeMessage,
      code,
      type
    },
    metadata: {
      package: PACKAGE_NAME,
      timestamp: new Date().toISOString(),
      version: PACKAGE_VERSION
    }
  };
}
