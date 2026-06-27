/**
 * @maitask/http-request
 * Production-grade HTTP client wrapper for Maitask Runtime.
 *
 * Features:
 * - Automatic retries with exponential backoff and retryable status handling
 * - Timeout handling with abort support
 * - Query parameters, authentication helpers, JSON, form, multipart, and raw bodies
 * - Response parsing for JSON, text, blob, arraybuffer, and base64
 * - Runtime-standardized items and summary metadata at the execution boundary
 */

const PACKAGE_NAME = '@maitask/http-request';
const PACKAGE_VERSION = '1.1.0';

async function execute(input, options = {}, context = {}) {
    const startedAt = Date.now();
    let config;
    let lastError = null;
    let attempts = 0;

    try {
        config = validateConfig(input, options, context);

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            attempts = attempt + 1;
            try {
                if (attempt > 0) {
                    await sleep(config.retryDelay * Math.pow(config.retryBackoffFactor, attempt - 1));
                }

                const response = await performRequest(config);
                const parsedBody = await parseBody(response, config.responseType);
                const responseData = buildResponseData(response, parsedBody);

                if (!isValidStatus(response.status, config.validateStatus)) {
                    const error = new Error(`Request failed with status code ${response.status}`);
                    error.code = 'HTTP_STATUS_ERROR';
                    error.status = response.status;
                    error.details = responseData;
                    throw error;
                }

                return buildSuccess(config, responseData, attempts, startedAt);
            } catch (error) {
                lastError = normalizeRequestError(error);
                if (!shouldRetry(lastError, config, attempt)) {
                    break;
                }
            }
        }

        return buildFailure(config, lastError, attempts, startedAt);
    } catch (error) {
        return buildFailure(config || {}, normalizeRequestError(error), attempts || 1, startedAt);
    }
}

execute;

function validateConfig(input, options = {}, context = {}) {
    const source = typeof input === 'string' ? { url: input } : asPlainObject(input, 'input');
    const merged = mergeObjects(options, source);
    const url = readRequiredString(merged.url, 'url');
    const method = normalizeMethod(merged.method || 'GET');
    const headers = buildHeaders(merged, context);
    const body = buildRequestBody(merged, method, headers);

    return {
        url: appendQueryParams(url, merged.params || merged.query),
        method,
        headers,
        body,
        timeout: readPositiveInt(merged.timeoutMs ?? merged.timeout, 30000, 1, 300000),
        responseType: normalizeResponseType(merged.responseType || merged.response_type || 'json'),
        validateStatus: normalizeStatusValidator(merged.validateStatus ?? merged.validate_status),
        maxRetries: readPositiveInt(merged.maxRetries ?? merged.retries, 3, 0, 10),
        retryDelay: readPositiveInt(merged.retryDelay ?? merged.retryDelayMs, 1000, 0, 60000),
        retryBackoffFactor: readPositiveNumber(merged.retryBackoffFactor, 2, 1, 10),
        retryStatuses: normalizeRetryStatuses(merged.retryStatuses || merged.retry_statuses),
        retryMethods: normalizeRetryMethods(merged.retryMethods || merged.retry_methods)
    };
}

async function performRequest(config) {
    ensureFetch();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);

    try {
        return await fetch(config.url, {
            method: config.method,
            headers: config.headers,
            body: config.body,
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            const timeoutError = new Error(`Request timed out after ${config.timeout}ms`);
            timeoutError.code = 'HTTP_TIMEOUT';
            timeoutError.type = 'TimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function buildResponseData(response, body) {
    const headers = Object.fromEntries(response.headers.entries());
    const data = {
        status: response.status,
        statusText: response.statusText,
        headers,
        body
    };
    data.items = [{
        status: response.status,
        statusText: response.statusText,
        headers,
        body
    }];
    data.summary = {
        total: 1,
        successCount: response.ok ? 1 : 0,
        failureCount: response.ok ? 0 : 1,
        status: response.status
    };
    return data;
}

function buildSuccess(config, responseData, attempts, startedAt) {
    return {
        success: true,
        data: responseData,
        metadata: {
            package: PACKAGE_NAME,
            version: PACKAGE_VERSION,
            url: config.url,
            method: config.method,
            attempt: attempts,
            attempts,
            executionMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        }
    };
}

function buildFailure(config, error, attempts, startedAt) {
    const details = error?.details || null;
    return {
        success: false,
        data: details || {
            items: [],
            summary: {
                total: 0,
                successCount: 0,
                failureCount: 1
            }
        },
        error: {
            message: error?.message || 'Request failed',
            code: error?.code || 'REQUEST_FAILED',
            type: error?.type || error?.name || 'HttpRequestError',
            details
        },
        metadata: {
            package: PACKAGE_NAME,
            version: PACKAGE_VERSION,
            url: config.url || null,
            method: config.method || null,
            attempts,
            executionMs: Date.now() - startedAt,
            timestamp: new Date().toISOString()
        }
    };
}

function buildHeaders(source, context) {
    const headers = normalizeHeaders(source.headers);
    const authHeaders = buildAuthHeaders(source.auth || source.authentication, context);
    for (const [key, value] of Object.entries(authHeaders)) {
        setHeader(headers, key, value);
    }
    return headers;
}

function buildAuthHeaders(auth, context) {
    if (!auth) return {};
    if (typeof auth === 'string') {
        return { Authorization: `Bearer ${resolveSecret(auth, context)}` };
    }
    if (!isPlainObject(auth)) {
        throw validationError('auth must be a string or object');
    }

    const type = String(auth.type || auth.scheme || 'bearer').toLowerCase();
    if (type === 'bearer') {
        const token = readRequiredString(resolveSecret(auth.token || auth.value, context), 'auth.token');
        return { Authorization: `Bearer ${token}` };
    }
    if (type === 'basic') {
        const username = readRequiredString(resolveSecret(auth.username, context), 'auth.username');
        const password = readRequiredString(resolveSecret(auth.password, context), 'auth.password');
        return { Authorization: `Basic ${encodeBase64(`${username}:${password}`)}` };
    }
    if (type === 'apikey' || type === 'api-key' || type === 'api_key') {
        const key = readRequiredString(resolveSecret(auth.key || auth.value, context), 'auth.key');
        const headerName = readRequiredString(auth.header || auth.headerName || 'X-API-Key', 'auth.header');
        return { [headerName]: key };
    }
    throw validationError(`Unsupported auth type '${auth.type}'`);
}

function buildRequestBody(source, method, headers) {
    if (method === 'GET' || method === 'HEAD') return undefined;

    if (source.multipart || source.formData || source.form_data) {
        return buildMultipartBody(source.multipart || source.formData || source.form_data, headers);
    }

    if (source.form || source.formUrlEncoded || source.form_urlencoded) {
        const params = new URLSearchParams();
        const form = source.form || source.formUrlEncoded || source.form_urlencoded;
        for (const [key, value] of Object.entries(asPlainObject(form, 'form'))) {
            if (value == null) continue;
            if (Array.isArray(value)) {
                value.forEach(item => params.append(key, String(item)));
            } else {
                params.append(key, String(value));
            }
        }
        ensureContentType(headers, 'application/x-www-form-urlencoded;charset=UTF-8');
        return params.toString();
    }

    const body = source.body ?? source.data ?? source.json;
    if (body == null) return undefined;

    if (typeof body === 'string' || isBlob(body) || isArrayBuffer(body) || isFormData(body) || isURLSearchParams(body)) {
        return body;
    }

    ensureContentType(headers, 'application/json');
    return JSON.stringify(body);
}

function buildMultipartBody(value, headers) {
    if (typeof FormData !== 'function') {
        throw validationError('multipart requires a runtime with FormData support');
    }

    const form = new FormData();
    const entries = asPlainObject(value, 'multipart');
    for (const [key, item] of Object.entries(entries)) {
        if (item == null) continue;
        appendMultipartValue(form, key, item);
    }
    removeHeader(headers, 'Content-Type');
    removeHeader(headers, 'content-type');
    return form;
}

function appendMultipartValue(form, key, item) {
    if (Array.isArray(item)) {
        item.forEach(value => appendMultipartValue(form, key, value));
        return;
    }

    if (isPlainObject(item) && Object.prototype.hasOwnProperty.call(item, 'data')) {
        const filename = item.filename || item.name;
        const contentType = item.contentType || item.content_type || 'application/octet-stream';
        const value = decodeMultipartData(item.data, contentType);
        if (filename) {
            form.append(key, value, filename);
        } else {
            form.append(key, value);
        }
        return;
    }

    form.append(key, item instanceof Blob ? item : String(item));
}

function decodeMultipartData(data, contentType) {
    if (isBlob(data)) return data;
    if (isArrayBuffer(data)) return new Blob([data], { type: contentType });
    if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) {
        return new Blob([data], { type: contentType });
    }
    if (typeof data === 'string') {
        return new Blob([decodeBase64(data)], { type: contentType });
    }
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

async function parseBody(response, type) {
    if (response.status === 204 || response.status === 205) return null;

    try {
        switch (type) {
            case 'json': {
                const text = await response.text();
                if (!text) return null;
                try {
                    return JSON.parse(text);
                } catch {
                    return text;
                }
            }
            case 'text':
                return await response.text();
            case 'blob':
                return await response.blob();
            case 'arraybuffer':
                return await response.arrayBuffer();
            case 'base64': {
                const buffer = await response.arrayBuffer();
                return encodeBase64FromBytes(new Uint8Array(buffer));
            }
            default:
                return await response.text();
        }
    } catch (error) {
        return null;
    }
}

function appendQueryParams(url, params) {
    if (!params) return url;
    const urlObject = new URL(url);
    for (const [key, value] of Object.entries(asPlainObject(params, 'params'))) {
        if (value == null) continue;
        if (Array.isArray(value)) {
            value.forEach(item => urlObject.searchParams.append(key, String(item)));
        } else {
            urlObject.searchParams.append(key, String(value));
        }
    }
    return urlObject.toString();
}

function normalizeHeaders(value) {
    const headers = {};
    if (!value) return headers;
    if (value instanceof Headers) {
        value.forEach((item, key) => {
            headers[key] = item;
        });
        return headers;
    }
    for (const [key, item] of Object.entries(asPlainObject(value, 'headers'))) {
        if (item == null) continue;
        headers[key] = String(item);
    }
    return headers;
}

function normalizeMethod(value) {
    const method = String(value || 'GET').trim().toUpperCase();
    const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!allowed.includes(method)) {
        throw validationError(`Unsupported HTTP method '${value}'`);
    }
    return method;
}

function normalizeResponseType(value) {
    const type = String(value || 'json').toLowerCase();
    const allowed = ['json', 'text', 'blob', 'arraybuffer', 'base64'];
    if (!allowed.includes(type)) {
        throw validationError(`Unsupported responseType '${value}'`);
    }
    return type;
}

function normalizeStatusValidator(value) {
    if (value === false || value === 'none') return () => true;
    if (typeof value === 'function') return value;
    if (Array.isArray(value)) {
        const statuses = new Set(value.map(Number).filter(Number.isFinite));
        return status => statuses.has(status);
    }
    if (isPlainObject(value)) {
        const min = value.min == null ? 200 : Number(value.min);
        const max = value.max == null ? 299 : Number(value.max);
        return status => status >= min && status <= max;
    }
    return status => status >= 200 && status < 300;
}

function normalizeRetryStatuses(value) {
    if (Array.isArray(value)) {
        return new Set(value.map(Number).filter(Number.isFinite));
    }
    return new Set([408, 425, 429, 500, 502, 503, 504]);
}

function normalizeRetryMethods(value) {
    const defaults = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
    const methods = Array.isArray(value) ? value : defaults;
    return new Set(methods.map(item => String(item).toUpperCase()));
}

function isValidStatus(status, validator) {
    try {
        return validator(status);
    } catch (error) {
        return false;
    }
}

function shouldRetry(error, config, attempt) {
    if (attempt >= config.maxRetries) return false;
    if (error.code === 'VALIDATION_ERROR') return false;
    if (error.code === 'HTTP_TIMEOUT' || error.code === 'NETWORK_ERROR') return true;
    if (!config.retryMethods.has(config.method)) return false;
    return error.status != null && config.retryStatuses.has(Number(error.status));
}

function normalizeRequestError(error) {
    if (!error) return new Error('Request failed');
    if (error.code) return error;
    if (error instanceof TypeError) {
        error.code = 'NETWORK_ERROR';
        error.type = 'NetworkError';
        return error;
    }
    error.code = error.code || 'REQUEST_FAILED';
    return error;
}

function ensureContentType(headers, value) {
    if (!hasHeader(headers, 'Content-Type')) {
        headers['Content-Type'] = value;
    }
}

function setHeader(headers, key, value) {
    removeHeader(headers, key);
    headers[key] = value;
}

function hasHeader(headers, key) {
    const lower = key.toLowerCase();
    return Object.keys(headers).some(item => item.toLowerCase() === lower);
}

function removeHeader(headers, key) {
    const lower = key.toLowerCase();
    for (const item of Object.keys(headers)) {
        if (item.toLowerCase() === lower) {
            delete headers[item];
        }
    }
}

function readRequiredString(value, key) {
    const text = value == null ? '' : String(value).trim();
    if (!text) throw validationError(`${key} is required`);
    return text;
}

function readPositiveInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const rounded = Math.floor(number);
    return Math.min(max, Math.max(min, rounded));
}

function readPositiveNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function validationError(message) {
    const error = new Error(message);
    error.code = 'VALIDATION_ERROR';
    error.type = 'ValidationError';
    return error;
}

function asPlainObject(value, name) {
    if (!isPlainObject(value)) {
        throw validationError(`${name} must be an object`);
    }
    return value;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(base, extra) {
    return Object.assign({}, base || {}, extra || {});
}

function resolveSecret(value, context) {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('$')) return value;
    const key = value.slice(1);
    return context?.secrets?.[key] ?? context?.env?.[key] ?? value;
}

function ensureFetch() {
    if (typeof fetch !== 'function') {
        throw validationError('Global fetch API is unavailable. Please run @maitask/http-request on Node.js 18 or newer.');
    }
}

function encodeBase64(value) {
    if (typeof btoa === 'function') return btoa(value);
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'utf8').toString('base64');
    throw validationError('Base64 encoding is not available in this runtime');
}

function decodeBase64(value) {
    if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64');
    if (typeof atob === 'function') {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    throw validationError('Base64 decoding is not available in this runtime');
}

function encodeBase64FromBytes(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === 'function') return btoa(binary);
    throw validationError('Base64 encoding is not available in this runtime');
}

function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isArrayBuffer(value) {
    return typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer;
}

function isFormData(value) {
    return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isURLSearchParams(value) {
    return typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
