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
        if (!input) {
            throw new Error('Input data is required for streaming');
        }

        const data = Array.isArray(input) ? input : [input];
        if (data.length === 0) {
            throw new Error('Input data is empty');
        }

        const mode = options.mode || 'chunked';
        if (!['chunked', 'sse'].includes(mode)) {
            throw new Error('Stream mode must be "chunked" or "sse"');
        }

        const url = new URL(String(options.url || options.endpoint || '').trim());
        if (url.username || url.password) {
            throw new Error('url must not include embedded credentials');
        }
        if (url.protocol !== 'https:' && options.allowInsecureHttp !== true) {
            throw new Error('url must use https unless allowInsecureHttp is enabled');
        }

        const secrets = {
            ...(options.secrets && typeof options.secrets === 'object' ? options.secrets : {}),
            ...(context.secrets && typeof context.secrets === 'object' ? context.secrets : {})
        };
        for (const value of Object.values(secrets)) {
            if (typeof value === 'string' && value) {
                activeSecrets.push(value);
            }
        }
        const rawHeaders = options.headers && typeof options.headers === 'object' ? options.headers : {};
        const headers = Object.create(null);
        for (const [k, v] of Object.entries(rawHeaders)) {
            if (v == null) continue;
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) || /[\r\n\0]/.test(String(v))) {
                throw new Error(`Invalid header '${k}'`);
            }
            headers[k] = String(v);
        }
        const tokenSecret = options.tokenSecret;
        if (tokenSecret) {
            const token = secrets[tokenSecret];
            if (!token) {
                throw new Error(`secret '${tokenSecret}' is required`);
            }
            headers.Authorization = `Bearer ${token}`;
        }
        if (mode === 'sse') {
            headers['Content-Type'] = headers['Content-Type'] || 'text/event-stream';
        } else {
            headers['Content-Type'] = headers['Content-Type'] || 'application/x-ndjson';
        }

        const streamData = prepareStreamData(data, mode);
        const eventName = String(options.event_name || options.eventName || 'message');
        if (/[\r\n]/.test(eventName)) {
            throw new Error('event_name must not contain newline characters');
        }
        const body = mode === 'sse'
            ? streamData.map(item => `event: ${eventName}\ndata: ${JSON.stringify(item.data)}\n\n`).join('')
            : streamData.map(item => JSON.stringify(item)).join('\n') + '\n';

        const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 30000, 1), 120000);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetch(url.toString(), {
                method: 'POST',
                headers,
                body,
                redirect: 'manual',
                timeoutMs,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }

        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
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
                    totalBytes += value.byteLength;
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

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
