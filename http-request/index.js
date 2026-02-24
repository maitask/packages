/**
 * @maitask/http-request
 * Production-grade HTTP client wrapper for Maitask Runtime
 *
 * Features:
 * - Automatic retries with exponential backoff
 * - Timeout handling
 * - Request/Response validation
 * - JSON parsing/serialization
 * - Detailed error reporting
 */

const PACKAGE_NAME = '@maitask/http-request';
const PACKAGE_VERSION = '1.0.0';

/**
 * Main execution function
 * @param {Object} input - Request configuration
 * @param {Object} options - Execution options
 * @param {Object} context - Execution context
 */
async function execute(input, options = {}, context = {}) {
    const config = validateConfig(input);
    const maxRetries = options.maxRetries ?? config.maxRetries ?? 3;
    const retryDelay = options.retryDelay ?? config.retryDelay ?? 1000;
    const timeout = options.timeout ?? config.timeout ?? 30000;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                await sleep(retryDelay * Math.pow(2, attempt - 1));
            }

            const response = await performRequest(config, timeout);
            
            // Validate response status if configured
            if (config.validateStatus) {
                validateStatus(response.status, config.validateStatus);
            }

            // Parse response body based on content-type or config
            const parsedBody = await parseBody(response, config.responseType);

            return {
                success: true,
                data: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: parsedBody
                },
                metadata: {
                    package: PACKAGE_NAME,
                    version: PACKAGE_VERSION,
                    url: config.url,
                    method: config.method,
                    attempt: attempt + 1,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            lastError = error;
            
            // Don't retry on certain errors (e.g. validation errors, 4xx client errors if not configured to retry)
            if (shouldNotRetry(error, config)) {
                break;
            }
        }
    }

    return {
        success: false,
        error: {
            message: lastError?.message || "Request failed",
            code: lastError?.code || "REQUEST_FAILED",
            type: lastError?.name || 'HttpRequestError',
            details: lastError?.details || null
        },
        metadata: {
            package: PACKAGE_NAME,
            version: PACKAGE_VERSION,
            url: config.url,
            attempts: maxRetries + 1,
            timestamp: new Date().toISOString()
        }
    };
}

// Export for Maitask runtime
execute;

/**
 * Validate and normalize input configuration
 */
function validateConfig(input) {
    if (!input) throw new Error("Input is required");
    
    // Handle simplified string input
    if (typeof input === 'string') {
        return {
            url: input,
            method: 'GET',
            headers: {},
            body: null,
            validateStatus: (status) => status >= 200 && status < 300
        };
    }

    if (!input.url) throw new Error("URL is required");

    return {
        url: input.url,
        method: (input.method || 'GET').toUpperCase(),
        headers: input.headers || {},
        body: input.body || input.data || null,
        timeout: input.timeout,
        responseType: input.responseType || 'json', // json, text, blob, arraybuffer
        validateStatus: input.validateStatus || ((status) => status >= 200 && status < 300),
        maxRetries: input.maxRetries,
        retryDelay: input.retryDelay
    };
}

/**
 * Perform the actual HTTP request using the global fetch API (polyfilled by Runtime)
 */
async function performRequest(config, timeout) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const fetchOptions = {
            method: config.method,
            headers: config.headers,
            signal: controller.signal
        };

        if (config.body && config.method !== 'GET' && config.method !== 'HEAD') {
            if (typeof config.body === 'object' && !isBlob(config.body) && !isArrayBuffer(config.body)) {
                fetchOptions.body = JSON.stringify(config.body);
                if (!fetchOptions.headers['Content-Type']) {
                    fetchOptions.headers['Content-Type'] = 'application/json';
                }
            } else {
                fetchOptions.body = config.body;
            }
        }

        const response = await fetch(config.url, fetchOptions);
        return response;
    } finally {
        clearTimeout(id);
    }
}

/**
 * Parse response body
 */
async function parseBody(response, type) {
    try {
        switch (type?.toLowerCase()) {
            case 'json':
                // Check if content is actually JSON before parsing
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    return await response.json();
                }
                // Fallback: try parsing text as JSON, return text if fails
                const text = await response.text();
                try {
                    return JSON.parse(text);
                } catch {
                    return text;
                }
            case 'text':
                return await response.text();
            case 'blob':
                return await response.blob();
            case 'arraybuffer':
                return await response.arrayBuffer();
            default:
                return await response.text();
        }
    } catch (e) {
        return null;
    }
}

/**
 * Validate HTTP status code
 */
function validateStatus(status, validator) {
    let isValid = false;
    if (typeof validator === 'function') {
        isValid = validator(status);
    } else if (Array.isArray(validator)) {
        isValid = validator.includes(status);
    } else {
        isValid = status >= 200 && status < 300;
    }

    if (!isValid) {
        const error = new Error(`Request failed with status code ${status}`);
        error.code = 'HTTP_ERROR';
        error.status = status;
        throw error;
    }
}

/**
 * Check if we should stop retrying
 */
function shouldNotRetry(error, config) {
    // Don't retry on validation errors (client side issues)
    if (error.code === 'VALIDATION_ERROR') return true;
    
    // Don't retry on 4xx errors (unless specific ones like 429)
    if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
        return true;
    }
    
    return false;
}

/**
 * Utility to sleep/delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type checks
 */
function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isArrayBuffer(value) {
    return typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer;
}
