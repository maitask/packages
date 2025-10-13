/**
 * @maitask/url-analyzer
 * URL parsing, validation, and analysis
 *
 * Features:
 * - URL parsing and component extraction
 * - Query string parsing
 * - URL validation
 * - URL normalization
 * - Domain analysis
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input URL or config
 * @param {Object} options - Analysis options
 * @param {Object} context - Execution context
 * @returns {Object} URL analysis results
 */
function execute(input, options = {}, context = {}) {
    try {
        const url = ensureUrl(input);
        const operation = options.operation || 'parse';

        let result;
        switch (operation) {
            case 'parse':
                result = parseUrl(url);
                break;
            case 'validate':
                result = validateUrl(url);
                break;
            case 'normalize':
                result = normalizeUrl(url);
                break;
            case 'query':
                result = parseQueryString(url);
                break;
            case 'analyze':
                result = analyzeUrl(url);
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }

        return {
            success: true,
            url,
            operation,
            result,
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'URL analysis error',
                code: 'URL_ERROR',
                type: error.constructor.name
            },
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * Ensure input is URL string
 */
function ensureUrl(input) {
    if (typeof input === 'string') {
        return input.trim();
    }

    if (input && typeof input.url === 'string') {
        return input.url.trim();
    }

    if (input && typeof input.text === 'string') {
        return input.text.trim();
    }

    throw new Error('Invalid input: URL string expected');
}

/**
 * Parse URL into components
 */
function parseUrl(url) {
    const urlPattern = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;
    const match = url.match(urlPattern);

    if (!match) {
        throw new Error('Invalid URL format');
    }

    const [, protocol, authority, path, query, fragment] = match;

    const auth = parseAuthority(authority || '');

    return {
        protocol: protocol || null,
        scheme: protocol || null,
        authority: authority || null,
        ...auth,
        path: path || '/',
        query: query || null,
        queryParams: query ? parseQueryParams(query) : {},
        fragment: fragment || null,
        hash: fragment ? `#${fragment}` : null
    };
}

/**
 * Parse authority component
 */
function parseAuthority(authority) {
    if (!authority) {
        return {
            username: null,
            password: null,
            host: null,
            hostname: null,
            port: null
        };
    }

    const authPattern = /^(?:([^:@]+)(?::([^@]+))?@)?([^:]+)(?::(\d+))?$/;
    const match = authority.match(authPattern);

    if (!match) {
        return {
            username: null,
            password: null,
            host: authority,
            hostname: authority,
            port: null
        };
    }

    const [, username, password, hostname, port] = match;

    return {
        username: username || null,
        password: password || null,
        host: authority,
        hostname: hostname || null,
        port: port ? parseInt(port) : null
    };
}

/**
 * Parse query string into key-value pairs
 */
function parseQueryParams(query) {
    const params = {};

    if (!query) return params;

    const pairs = query.split('&');

    for (const pair of pairs) {
        const [key, value] = pair.split('=').map(decodeURIComponent);

        if (key in params) {
            if (Array.isArray(params[key])) {
                params[key].push(value || '');
            } else {
                params[key] = [params[key], value || ''];
            }
        } else {
            params[key] = value || '';
        }
    }

    return params;
}

/**
 * Parse query string from URL
 */
function parseQueryString(url) {
    const parsed = parseUrl(url);
    return {
        query: parsed.query,
        params: parsed.queryParams
    };
}

/**
 * Validate URL
 */
function validateUrl(url) {
    const issues = [];

    try {
        const parsed = parseUrl(url);

        if (!parsed.protocol) {
            issues.push('Missing protocol');
        } else if (!['http', 'https', 'ftp', 'ws', 'wss'].includes(parsed.protocol)) {
            issues.push(`Unsupported protocol: ${parsed.protocol}`);
        }

        if (!parsed.hostname) {
            issues.push('Missing hostname');
        } else {
            if (!isValidHostname(parsed.hostname)) {
                issues.push('Invalid hostname format');
            }
        }

        if (parsed.port !== null && (parsed.port < 1 || parsed.port > 65535)) {
            issues.push('Invalid port number');
        }

        return {
            valid: issues.length === 0,
            issues: issues.length > 0 ? issues : null,
            parsed
        };
    } catch (error) {
        return {
            valid: false,
            issues: [error.message],
            parsed: null
        };
    }
}

/**
 * Validate hostname
 */
function isValidHostname(hostname) {
    if (!hostname) return false;

    if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        const parts = hostname.split('.');
        return parts.every(p => {
            const num = parseInt(p);
            return num >= 0 && num <= 255;
        });
    }

    const domainPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    return domainPattern.test(hostname);
}

/**
 * Normalize URL
 */
function normalizeUrl(url) {
    const parsed = parseUrl(url);

    const protocol = (parsed.protocol || 'http').toLowerCase();
    const hostname = (parsed.hostname || '').toLowerCase();

    const defaultPorts = { http: 80, https: 443, ftp: 21 };
    const port = parsed.port === defaultPorts[protocol] ? null : parsed.port;

    let path = parsed.path || '/';
    path = path.replace(/\/+/g, '/');
    if (path !== '/' && path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    const queryPairs = [];
    const sortedKeys = Object.keys(parsed.queryParams).sort();
    for (const key of sortedKeys) {
        const value = parsed.queryParams[key];
        if (Array.isArray(value)) {
            for (const v of value) {
                queryPairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
            }
        } else {
            queryPairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
    }

    const query = queryPairs.length > 0 ? `?${queryPairs.join('&')}` : '';
    const fragment = parsed.fragment ? `#${parsed.fragment}` : '';

    const portString = port ? `:${port}` : '';
    const normalized = `${protocol}://${hostname}${portString}${path}${query}${fragment}`;

    return {
        original: url,
        normalized
    };
}

/**
 * Analyze URL
 */
function analyzeUrl(url) {
    const parsed = parseUrl(url);
    const validation = validateUrl(url);

    const domain = extractDomain(parsed.hostname);
    const pathSegments = parsed.path.split('/').filter(s => s);

    return {
        ...parsed,
        validation: {
            valid: validation.valid,
            issues: validation.issues
        },
        domain: {
            full: parsed.hostname,
            ...domain
        },
        path: {
            full: parsed.path,
            segments: pathSegments,
            depth: pathSegments.length,
            extension: extractExtension(parsed.path)
        },
        query: {
            string: parsed.query,
            params: parsed.queryParams,
            count: Object.keys(parsed.queryParams).length
        },
        security: {
            isSecure: parsed.protocol === 'https',
            hasAuth: !!(parsed.username || parsed.password),
            hasFragment: !!parsed.fragment
        }
    };
}

/**
 * Extract domain components
 */
function extractDomain(hostname) {
    if (!hostname) return { subdomain: null, domain: null, tld: null };

    const parts = hostname.split('.');

    if (parts.length < 2) {
        return { subdomain: null, domain: hostname, tld: null };
    }

    const tld = parts[parts.length - 1];
    const domain = parts[parts.length - 2];
    const subdomain = parts.length > 2 ? parts.slice(0, -2).join('.') : null;

    return { subdomain, domain, tld };
}

/**
 * Extract file extension from path
 */
function extractExtension(path) {
    const match = path.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : null;
}
