/**
 * @maitask/cf-proxy
 *
 * Cloudflare Worker proxy for GitHub and Docker registry acceleration.
 * Handles intelligent redirects, authentication, and AWS S3 signature headers.
 *
 * @param {Object} input - Configuration and request data
 * @param {string} input.url - Target URL to proxy
 * @param {string} [input.method='GET'] - HTTP method
 * @param {Object} [input.headers={}] - Request headers
 * @param {Object} [input.config] - Proxy configuration
 * @param {string[]} [input.config.allowedHosts] - Whitelist of allowed domains
 * @param {boolean} [input.config.restrictPaths=false] - Enable path restrictions
 * @param {string[]} [input.config.allowedPaths] - Allowed path keywords
 * @param {number} [input.config.maxRedirects=5] - Maximum redirect follow count
 * @param {Object} options - Execution options
 * @param {Object} context - Execution context
 * @returns {Object} Proxy response with status, headers, and body
 */
async function main(input, options, context) {
    // Default configuration
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

    const config = {
        allowedHosts: input.config?.allowedHosts || DEFAULT_ALLOWED_HOSTS,
        restrictPaths: input.config?.restrictPaths || false,
        allowedPaths: input.config?.allowedPaths || ['library'],
        maxRedirects: input.config?.maxRedirects || 5
    };

    // Validate input
    if (!input.url) {
        throw new Error('URL is required');
    }

    // Parse URL using simpler method for compatibility
    let targetDomain, targetPath;
    try {
        const urlMatch = input.url.match(/^https?:\/\/([^\/]+)(\/.*)?$/);
        if (!urlMatch) {
            throw new Error('Invalid URL format');
        }
        targetDomain = urlMatch[1];
        targetPath = (urlMatch[2] || '/').substring(1);
    } catch (e) {
        throw new Error(`Failed to parse URL: ${e.message}`);
    }

    // Domain whitelist check
    if (!config.allowedHosts.includes(targetDomain)) {
        throw new Error(`Domain ${targetDomain} not in allowed list`);
    }

    // Path whitelist check (if enabled)
    if (config.restrictPaths) {
        const isPathAllowed = config.allowedPaths.some(pathString =>
            targetPath.toLowerCase().includes(pathString.toLowerCase())
        );
        if (!isPathAllowed) {
            throw new Error(`Path ${targetPath} not in allowed paths`);
        }
    }

    // Detect if this is a Docker registry request
    const isDockerRequest = [
        'quay.io',
        'gcr.io',
        'k8s.gcr.io',
        'registry.k8s.io',
        'ghcr.io',
        'docker.cloudsmith.io',
        'registry-1.docker.io'
    ].includes(targetDomain);

    // Prepare request headers
    const requestHeaders = input.headers || {};
    requestHeaders.Host = targetDomain;

    // Check if target is AWS S3
    const isS3 = targetDomain.includes('amazonaws.com');
    if (isS3) {
        requestHeaders['x-amz-content-sha256'] = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z';
        requestHeaders['x-amz-date'] = now;
    }

    // Make HTTP request using httpRequest helper
    const response = await httpRequest(input.url, {
        method: input.method || 'GET',
        headers: requestHeaders
    });

    // Handle Docker authentication challenge (401)
    if (isDockerRequest && response.status === 401) {
        const wwwAuth = response.headers['www-authenticate'] || response.headers['WWW-Authenticate'];
        if (wwwAuth) {
            const authMatch = wwwAuth.match(/Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/);
            if (authMatch) {
                const [, realm, service, scope] = authMatch;

                // Get authentication token
                const tokenUrl = `${realm}?service=${service || targetDomain}&scope=${scope}`;
                const tokenResponse = await httpRequest(tokenUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });

                if (tokenResponse.ok) {
                    const tokenData = JSON.parse(tokenResponse.body);
                    const token = tokenData.token || tokenData.access_token;

                    if (token) {
                        // Retry request with token
                        requestHeaders.Authorization = `Bearer ${token}`;
                        const authedResponse = await httpRequest(input.url, {
                            method: input.method || 'GET',
                            headers: requestHeaders
                        });
                        return processResponse(authedResponse, config.maxRedirects, requestHeaders, 0);
                    }
                }
            }
        }
    }

    // Handle redirects (302/307) for Docker registry
    if (isDockerRequest && (response.status === 302 || response.status === 307)) {
        const redirectUrl = response.headers.location || response.headers.Location;
        if (redirectUrl) {
            return await handleRedirect(redirectUrl, requestHeaders, config.maxRedirects, 1);
        }
    }

    return {
        success: true,
        status: response.status,
        statusText: response.ok ? 'OK' : 'Error',
        headers: response.headers,
        body: response.body,
        metadata: {
            targetDomain,
            targetPath,
            isDockerRequest,
            isS3,
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Handle HTTP redirects recursively
 */
async function handleRedirect(redirectUrl, headers, maxRedirects, currentRedirect) {
    if (currentRedirect >= maxRedirects) {
        throw new Error(`Max redirects (${maxRedirects}) exceeded`);
    }

    const domainMatch = redirectUrl.match(/^https?:\/\/([^\/]+)/);
    const redirectDomain = domainMatch ? domainMatch[1] : '';
    headers.Host = redirectDomain;

    // Add AWS headers if redirecting to S3
    if (redirectDomain.includes('amazonaws.com')) {
        headers['x-amz-content-sha256'] = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z';
        headers['x-amz-date'] = now;
    }

    const response = await httpRequest(redirectUrl, {
        method: 'GET',
        headers
    });

    // Handle further redirects
    if (response.status === 302 || response.status === 307) {
        const nextRedirect = response.headers.location || response.headers.Location;
        if (nextRedirect) {
            return await handleRedirect(nextRedirect, headers, maxRedirects, currentRedirect + 1);
        }
    }

    return processResponse(response, maxRedirects, headers, currentRedirect);
}

/**
 * Process final response
 */
function processResponse(response, maxRedirects, headers, redirectCount) {
    return {
        success: response.ok,
        status: response.status,
        statusText: response.ok ? 'OK' : 'Error',
        headers: response.headers,
        body: response.body,
        metadata: {
            redirectCount,
            maxRedirects,
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * HTTP request helper (uses Deno Core op_http_request)
 */
async function httpRequest(url, options) {
    try {
        // Use Deno Core op system
        const response = await Deno.core.ops.op_http_request(url, options);

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.ok ? 'OK' : 'Error',
            headers: response.headers || {},
            body: response.body || ''
        };
    } catch (error) {
        throw new Error(`HTTP request failed: ${error.message}`);
    }
}

// Export main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { main };
} else {
    globalThis.main = main;
}
