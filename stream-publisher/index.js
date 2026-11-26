/**
 * @maitask/stream-publisher
 * Publish NDJSON or SSE event streams to an HTTPS endpoint.
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */
const MAX_ERROR_BYTES = 16 * 1024;

async function execute(input, options = {}, context = {}) {
    const activeSecrets = [];
    try {
        const safeOptions = isPlainObject(options) ? options : {};
        const safeContext = isPlainObject(context) ? context : {};
        if (!input) {
            throw new Error('Input data is required for streaming');
        }

        const data = Array.isArray(input) ? input : [input];
        if (data.length === 0) {
            throw new Error('Input data is empty');
        }

        const mode = safeOptions.mode || 'chunked';
        if (!['chunked', 'sse'].includes(mode)) {
            throw new Error('Stream mode must be "chunked" or "sse"');
        }

        const url = new URL(String(safeOptions.url || safeOptions.endpoint || '').trim());
        if (url.username || url.password) {
            throw new Error('url must not include embedded credentials');
        }
        if (url.protocol !== 'https:' && safeOptions.allowInsecureHttp !== true) {
            throw new Error('url must use https unless allowInsecureHttp is enabled');
        }
        if (safeOptions.allowPrivateHosts !== true && isBlockedHost(url.hostname)) {
            throw new Error('url host is not permitted');
        }

        const secrets = Object.create(null);
        copySafeOwnEntries(secrets, safeOptions.secrets);
        copySafeOwnEntries(secrets, safeContext.secrets);
        for (const key of Object.keys(secrets)) {
            const value = secrets[key];
            if (typeof value === 'string' && value) {
                activeSecrets.push(value);
            }
        }
        const rawHeaders = isPlainObject(safeOptions.headers) ? safeOptions.headers : {};
        const headers = Object.create(null);
        for (const k of Object.keys(rawHeaders)) {
            if (!Object.hasOwn(rawHeaders, k) || !isSafeKey(k)) continue;
            const v = rawHeaders[k];
            if (v == null) continue;
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) || /[\r\n\0]/.test(String(v))) {
                throw new Error(`Invalid header '${k}'`);
            }
            headers[k] = String(v);
        }
        const tokenSecret = safeOptions.tokenSecret;
        if (tokenSecret) {
            const secretKey = String(tokenSecret);
            if (!isSafeKey(secretKey) || !Object.hasOwn(secrets, secretKey) || !secrets[secretKey]) {
                throw new Error(`secret '${secretKey}' is required`);
            }
            headers.Authorization = `Bearer ${secrets[secretKey]}`;
        }
        if (mode === 'sse') {
            headers['Content-Type'] = headers['Content-Type'] || 'text/event-stream';
        } else {
            headers['Content-Type'] = headers['Content-Type'] || 'application/x-ndjson';
        }

        const streamData = prepareStreamData(data, mode);
        const eventName = String(safeOptions.event_name || safeOptions.eventName || 'message');
        if (/[\r\n]/.test(eventName)) {
            throw new Error('event_name must not contain newline characters');
        }
        const body = mode === 'sse'
            ? streamData.map(item => `event: ${eventName}\ndata: ${JSON.stringify(item.data)}\n\n`).join('')
            : streamData.map(item => JSON.stringify(item)).join('\n') + '\n';

        const timeoutMs = Math.min(Math.max(Number(safeOptions.timeoutMs) || 30000, 1), 120000);
        const runtimeFetch = usesMaitaskRuntimeFetch();
        const controller = runtimeFetch ? null : new AbortController();
        const timer = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            const fetchInit = {
                method: 'POST',
                headers,
                body,
                redirect: 'manual',
                timeoutMs
            };
            if (runtimeFetch) {
                fetchInit.maxResponseBytes = MAX_ERROR_BYTES;
            } else {
                fetchInit.signal = controller.signal;
            }
            response = await fetch(url.toString(), fetchInit);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error(`Stream request timed out after ${timeoutMs}ms`);
            }
            throw err;
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }

        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
            if (response?.body && typeof response.body.cancel === 'function') {
                try { await response.body.cancel(); } catch {}
            }
            throw new Error('Stream publisher does not follow HTTP redirects');
        }

        if (!response.ok) {
            const errorText = await readBoundedErrorText(response, MAX_ERROR_BYTES);
            throw new Error(errorText || `Stream publish failed with status ${response.status}`);
        }

        return {
            success: true,
            data: {
                items: streamData.slice(0, 20),
                summary: {
                    mode,
                    eventCount: streamData.length,
                    status: response.status,
                    bytes: body.length
                }
            },
            metadata: {
                package: '@maitask/stream-publisher',
                version: '0.1.1',
                endpoint: `${url.origin}${url.pathname}`,
                mode,
                publishedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: redactSecrets(error?.message || 'Unknown stream publishing error', activeSecrets),
                code: 'STREAM_PUBLISH_ERROR',
                type: 'StreamPublishError'
            },
            metadata: {
                package: '@maitask/stream-publisher',
                publishedAt: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    }
}

async function readBoundedErrorText(response, maxBytes) {
    if (response?.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
        let out = '';
        let totalBytes = 0;
        try {
            while (totalBytes < maxBytes) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    const remaining = maxBytes - totalBytes;
                    const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
                    out += decoder ? decoder.decode(slice, { stream: true }) : String.fromCharCode(...slice);
                    totalBytes += slice.byteLength;
                    if (totalBytes >= maxBytes) break;
                }
            }
        } finally {
            try {
                await reader.cancel();
            } catch {}
        }
        if (decoder) out += decoder.decode();
        return out;
    }
    if (typeof response?.text === 'function') {
        const text = await response.text();
        return typeof text === 'string' ? text.slice(0, maxBytes) : '';
    }
    return '';
}

function redactSecrets(message, secrets) {
    let text = String(message || 'Unknown stream publishing error');
    for (const secret of secrets || []) {
        if (typeof secret === 'string' && secret) {
            text = text.split(secret).join('[redacted]');
        }
    }
    return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
}

/**
 * Prepare data for streaming based on mode
 */
function prepareStreamData(data, mode) {
    if (mode === 'sse') {
        // SSE requires structured events
        return data.map((item, index) => ({
            id: index + 1,
            data: item,
            type: 'event'
        }));
    }

    // Chunked mode uses raw data
    return data;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function copySafeOwnEntries(target, source) {
    if (!isPlainObject(source)) return;
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

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
