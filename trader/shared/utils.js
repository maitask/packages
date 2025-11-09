export function mergeObjects(base = {}, extra = {}) {
    return { ...(base || {}), ...(extra || {}) };
}

export function toNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

export function sanitizePrecision(value, precision = 4) {
    if (!Number.isFinite(value) || value <= 0) return null;
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}

export function normalizeParams(params = {}) {
    const result = {};
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }
        result[key] = Array.isArray(value) ? value.join(',') : value;
    });
    return result;
}

export async function handleJSON(response) {
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (err) {
        throw new Error(`Invalid JSON response: ${err.message}`);
    }
    if (!response.ok) {
        const msg = data?.msg || data?.message || response.statusText;
        throw new Error(`HTTP ${response.status}: ${msg}`);
    }
    return data;
}

export function ensureFetch(requiredBy = '@maitask/trader') {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is required. Please run ${requiredBy} on Node.js 18+/Deno.`);
    }
}

export function ensureCrypto() {
    if (!globalThis.crypto && typeof require !== 'function') {
        throw new Error('Crypto module is required for signing requests.');
    }
}

export async function signPayload(secret, payload) {
    if (globalThis.crypto?.subtle) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
        return bufferToHex(signature);
    }
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', secret).update(payload).digest('hex');
}

export function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
