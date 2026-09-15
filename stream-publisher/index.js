/**
 * @maitask/stream-publisher
 * Publish NDJSON or SSE event streams to an HTTPS endpoint.
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */
async function execute(input, options = {}, context = {}) {
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
            ...(context.secrets && typeof context.secrets === 'object' ? context.secrets : {}),
            ...(options.secrets && typeof options.secrets === 'object' ? options.secrets : {})
        };
        const headers = { ...(options.headers || {}) };
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
        const eventName = options.event_name || options.eventName || 'message';
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
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }

        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Stream publish failed with status ${response.status}`);
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
                version: '0.1.0',
                endpoint: `${url.origin}${url.pathname}`,
                mode,
                publishedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown stream publishing error',
                code: 'STREAM_PUBLISH_ERROR',
                type: 'StreamPublishError'
            },
            metadata: {
                publishedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
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
