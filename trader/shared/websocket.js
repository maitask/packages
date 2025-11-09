let WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null;

async function loadWebSocketClass() {
    if (WebSocketImpl) {
        return WebSocketImpl;
    }

    try {
        const wsModule = await import('ws');
        WebSocketImpl = wsModule?.WebSocket || wsModule?.default || wsModule;
        if (!WebSocketImpl) {
            throw new Error('Module ws did not export WebSocket constructor');
        }
        return WebSocketImpl;
    } catch (err) {
        throw new Error(`WebSocket API unavailable in this runtime: ${err.message}`);
    }
}

function normalizeMessageData(data) {
    if (typeof data === 'string') {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return new TextDecoder().decode(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data);
    }
    if (typeof data === 'object' && data !== null && data.data) {
        return normalizeMessageData(data.data);
    }
    return data;
}

export async function collectWebSocketFeed({
    url,
    protocols,
    messageLimit = 20,
    durationMs = 5000,
    onOpen,
    transform,
    shouldInclude,
}) {
    const WS = await loadWebSocketClass();
    const messages = [];

    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            if (settled) return;
            settled = true;
            try {
                ws.close();
            } catch {
                // ignore
            }
            clearTimeout(timeout);
        };

        const resolveWith = (value) => {
            cleanup();
            resolve(value);
        };

        const rejectWith = (error) => {
            cleanup();
            reject(error);
        };

        const ws = new WS(url, protocols);
        const attach = (event, handler) => {
            if (typeof ws.addEventListener === 'function') {
                ws.addEventListener(event, handler);
            } else if (typeof ws.on === 'function') {
                ws.on(event, handler);
            } else {
                ws[`on${event}`] = handler;
            }
        };
        const timeout = setTimeout(() => {
            resolveWith(messages);
        }, durationMs);

        attach('open', () => {
            if (typeof onOpen === 'function') {
                try {
                    onOpen(ws);
                } catch (err) {
                    rejectWith(err);
                }
            }
        });

        attach('error', (event) => {
            rejectWith(new Error(`WebSocket error: ${event?.message || 'unknown'}`));
        });

        attach('message', (event) => {
            try {
                const raw = normalizeMessageData(event?.data ?? event);
                const transformed = typeof transform === 'function' ? transform(raw) : raw;
                if (shouldInclude && !shouldInclude(transformed)) {
                    return;
                }
                messages.push(transformed);
                if (messages.length >= messageLimit) {
                    resolveWith(messages);
                }
            } catch (err) {
                rejectWith(err);
            }
        });

        attach('close', () => {
            resolveWith(messages);
        });
    });
}
