async function execute(input, options, context) {
    try {
        ensureFetch('web-search');

        var config = buildConfig(input, options, context);
        if (!config.query) {
            throw new Error('Search query is required');
        }

        var searchResult = await performSearch(config);
        return {
            success: true,
            data: {
                query: config.query,
                engine: searchResult.engine,
                page: config.page,
                offset: config.offset,
                limit: config.limit,
                totalResults: searchResult.results.length,
                results: searchResult.results,
                fetchedAt: new Date().toISOString()
            },
            metadata: {
                package: '@maitask/web-search',
                version: '0.1.2',
                ...searchResult.metadata,
                timestamp: new Date().toISOString()
            },
            pagination: searchResult.pagination || null
        };
    } catch (err) {
        return {
            success: false,
            error: {
                message: err.message || String(err),
                code: 'WEB_SEARCH_ERROR',
                type: err.name || 'WebSearchError'
            },
            metadata: {
                package: '@maitask/web-search',
                version: '0.1.2',
                timestamp: new Date().toISOString()
            }
        };
    }
}

function buildConfig(input, options, context) {
    var safeOptions = isPlainObject(options) ? options : {};
    var safeInput = isPlainObject(input) ? input : {};
    var baseConfig = context && isPlainObject(context.defaults)
        ? mergeObjects(context.defaults, safeOptions)
        : mergeObjects({}, safeOptions);

    var trustedEnvBaseUrl = context && isPlainObject(context.env) && context.env.WEB_SEARCH_BASE_URL
        ? context.env.WEB_SEARCH_BASE_URL
        : null;
    if (trustedEnvBaseUrl && !baseConfig.baseUrl) {
        baseConfig.baseUrl = trustedEnvBaseUrl;
    }

    var allowPrivateHosts = baseConfig.allowPrivateHosts === true;
    var rawTimeout = Number(baseConfig.timeoutMs);
    var timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
        ? Math.min(Math.max(Math.trunc(rawTimeout), 1000), 120000)
        : 30000;
    var rawMaxBytes = Number(baseConfig.maxResponseBytes);
    var maxResponseBytes = Number.isFinite(rawMaxBytes) && rawMaxBytes > 0
        ? Math.min(Math.max(Math.trunc(rawMaxBytes), 1024), 10 * 1024 * 1024)
        : 5 * 1024 * 1024;

    var limitSource = safeInput.limit !== undefined ? safeInput.limit : baseConfig.limit;
    var limit = typeof limitSource === 'number' ? limitSource : 10;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;  // Allow up to 100 results

    var pageSource = safeInput.page !== undefined ? safeInput.page : baseConfig.page;
    var page = typeof pageSource === 'number' ? pageSource : 1;
    if (page < 1) page = 1;

    var offsetSource = safeInput.offset !== undefined ? safeInput.offset : baseConfig.offset;
    var offset = typeof offsetSource === 'number' ? offsetSource : (page - 1) * limit;
    if (offset < 0) offset = 0;

    var rawQuery = safeInput.query !== undefined ? safeInput.query : baseConfig.query;
    var rawEngine = safeInput.engine !== undefined ? safeInput.engine : baseConfig.engine;
    var rawLanguage = safeInput.language !== undefined ? safeInput.language : baseConfig.language;
    var rawRegion = safeInput.region !== undefined ? safeInput.region : baseConfig.region;
    var includeSnippetsVal = safeInput.includeSnippets !== undefined ? safeInput.includeSnippets : baseConfig.includeSnippets;
    var safeSearchVal = safeInput.safeSearch !== undefined ? safeInput.safeSearch : baseConfig.safeSearch;
    var nextPageTokenVal = safeInput.nextPageToken !== undefined ? safeInput.nextPageToken : baseConfig.nextPageToken;

    return {
        query: String(rawQuery || '').trim(),
        engine: String(rawEngine || 'duckduckgo').toLowerCase(),
        limit: limit,
        page: page,
        offset: offset,
        language: String(rawLanguage || 'en').toLowerCase(),
        region: String(rawRegion || 'us').toLowerCase(),
        includeSnippets: includeSnippetsVal !== false,
        safeSearch: safeSearchVal || 'moderate',
        headers: normalizeHeaders(baseConfig.headers),
        nextPageToken: nextPageTokenVal || null,
        timeoutMs: timeoutMs,
        maxResponseBytes: maxResponseBytes,
        allowPrivateHosts: allowPrivateHosts,
        baseUrl: baseConfig.baseUrl ? normalizeBaseUrl(baseConfig.baseUrl, allowPrivateHosts) : null,
        engineBaseUrls: normalizeEngineBaseUrls(baseConfig.engineBaseUrls, allowPrivateHosts)
    };
}

async function performSearch(config) {

    if (config.engine === 'bing') {
        try {
            return await searchBing(config);
        } catch (err) {
            // fallback to DuckDuckGo
        }
    }

    if (config.engine === 'google') {
        try {
            return await searchGoogle(config);
        } catch (err) {
            // fallback to DuckDuckGo
        }
    }

    return await searchDuckDuckGo(config);
}

async function searchDuckDuckGo(config) {
    var params = {
        q: config.query,
        kl: 'en-us',
        kp: '1'
    };

    // Add pagination support
    if (config.offset > 0) {
        params.s = config.offset;
    }

    var url = buildSearchUrl('duckduckgo', '/html/', params, config);

    try {
        var html = await fetchPage(url, config);
        var results = parseDuckDuckGo(html, config.limit, config.includeSnippets);

        // Check if there are more results
        var hasNextPage = html.indexOf('class="nav-link"') > -1 || results.length >= config.limit;
        var pagination = {
            currentPage: config.page,
            hasNextPage: hasNextPage,
            nextPage: hasNextPage ? config.page + 1 : null,
            nextOffset: hasNextPage ? config.offset + config.limit : null
        };

        return {
            engine: 'duckduckgo',
            results: results,
            metadata: { sourceUrl: url },
            pagination: pagination
        };
    } catch (err) {
        throw buildSearchError('DuckDuckGo', url, err);
    }
}

async function searchBing(config) {
    var params = {
        q: config.query,
        count: Math.min(config.limit, 50)
    };

    // Add pagination support
    if (config.offset > 0) {
        params.first = config.offset + 1;  // Bing uses 1-based indexing
    }

    var url = buildSearchUrl('bing', '/search', params, config);

    try {
        var html = await fetchPage(url, config);
        var results = parseBing(html, config.limit, config.includeSnippets);

        // Check if there are more results
        var hasNextPage = html.indexOf('class="sb_pagN"') > -1 || results.length >= config.limit;
        var pagination = {
            currentPage: config.page,
            hasNextPage: hasNextPage,
            nextPage: hasNextPage ? config.page + 1 : null,
            nextOffset: hasNextPage ? config.offset + config.limit : null
        };

        return {
            engine: 'bing',
            results: results,
            metadata: { sourceUrl: url },
            pagination: pagination
        };
    } catch (err) {
        throw buildSearchError('Bing', url, err);
    }
}

async function searchGoogle(config) {
    var params = {
        q: config.query,
        num: Math.min(config.limit, 100)
    };

    // Add pagination support
    if (config.offset > 0) {
        params.start = config.offset;
    }

    var url = buildSearchUrl('google', '/search', params, config);

    try {
        var html = await fetchPage(url, config);
        var results = parseGoogle(html, config.limit, config.includeSnippets);

        // Check if there are more results
        var hasNextPage = html.indexOf('id="pnnext"') > -1 || results.length >= config.limit;
        var pagination = {
            currentPage: config.page,
            hasNextPage: hasNextPage,
            nextPage: hasNextPage ? config.page + 1 : null,
            nextOffset: hasNextPage ? config.offset + config.limit : null
        };

        return {
            engine: 'google',
            results: results,
            metadata: { sourceUrl: url },
            pagination: pagination
        };
    } catch (err) {
        throw buildSearchError('Google', url, err);
    }
}

async function fetchPage(url, config) {
    var requestHeaders = mergeObjects({
        'User-Agent': 'Mozilla/5.0 (compatible; MaitaskWebSearch/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    }, config.headers || {});
    var timeoutMs = config.timeoutMs || 30000;
    var maxBytes = config.maxResponseBytes || (5 * 1024 * 1024);
    var runtimeFetch = usesMaitaskRuntimeFetch();
    var controller = runtimeFetch ? null : new AbortController();
    var timer = runtimeFetch ? null : setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
        var fetchInit = {
            method: 'GET',
            headers: requestHeaders,
            redirect: 'manual',
            timeoutMs: timeoutMs
        };
        if (runtimeFetch) {
            fetchInit.maxResponseBytes = maxBytes;
        } else {
            fetchInit.signal = controller.signal;
        }

        var response = await fetch(url, fetchInit);
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
            if (response && response.body && typeof response.body.cancel === 'function') {
                try { await response.body.cancel(); } catch (_err) {}
            }
            throw new Error('Search engine redirects are not allowed');
        }
        if (!response.ok) {
            if (response && response.body && typeof response.body.cancel === 'function') {
                try { await response.body.cancel(); } catch (_err) {}
            }
            throw new Error('Search request failed with status ' + response.status);
        }

        return await readBoundedText(response, maxBytes);
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error('Search request timed out after ' + timeoutMs + 'ms');
        }
        throw err;
    } finally {
        if (timer !== null) {
            clearTimeout(timer);
        }
    }
}

function buildSearchError(engine, _url, err) {
    var message = String(err && err.message ? err.message : (err || 'Search request failed'))
        .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
    var error = new Error(engine + ' search request failed: ' + message);
    error.name = 'WebSearchRequestError';
    return error;
}

// Parse DuckDuckGo search results with improved accuracy
function parseDuckDuckGo(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        return results;
    }

    // Improved patterns for DuckDuckGo results
    var resultBlocks = html.split('<div class="result result');
    resultBlocks.shift(); // Remove first element that doesn't contain a result

    var rank = 1;
    var foundCount = 0;

    for (var i = 0; i < resultBlocks.length && results.length < limit; i++) {
        var block = resultBlocks[i];

        // Extract URL
        var urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
        if (!urlMatch) {
            // Try alternative URL pattern
            urlMatch = block.match(/<a rel="nofollow noopener noreferrer" href="(https?:\/\/[^"]+)"/);
        }
        if (!urlMatch) continue;
        var url = cleanUrl(urlMatch[1]);

        // Extract title
        var titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (!titleMatch) continue;
        var title = cleanText(titleMatch[1]);

        // Extract snippet
        var snippet = '';
        if (includeSnippets) {
            var snippetMatch = block.match(/<a[^>]*>[\s\S]*?<\/a>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>|<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
            if (snippetMatch) {
                snippet = cleanText(snippetMatch[1] || snippetMatch[2] || '');
            }
        }

        if (url && title && url.length > 10 && title.length > 3 && isValidUrl(url)) {
            if (!isAdResult(url, title) && !hasDuplicateUrl(results, url)) {
                results.push(buildResult(rank++, title, url, snippet, 'duckduckgo'));
                foundCount++;
            }
        }
    }
    return results;
}

function parseBing(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        return results;
    }

    // Improved patterns for Bing search results
    // Look for li elements with class containing "b_algo" which are the main results
    var algoStart = html.indexOf('<li class="b_algo"');
    var algoEnd = -1;
    var foundCount = 0;

    while (algoStart !== -1 && results.length < limit) {
        algoEnd = html.indexOf('</li>', algoStart);
        if (algoEnd === -1) break;

        var block = html.substring(algoStart, algoEnd + 4);
        // Move to end of current block for next search
        var nextSearch = algoEnd + 4;

        // Extract URL - try different patterns
        var url = '';
        var urlMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/i);
        if (urlMatch) {
            url = cleanUrl(urlMatch[1]);
        } else {
            // Try the citation pattern
            urlMatch = block.match(/<cite[^>]*>(.*?)<\/cite>/);
            if (urlMatch) {
                var rawUrl = urlMatch[1].replace(/<[^>]*>/g, '').replace(/http:\/\//, '').replace(/https:\/\//, '');
                if (rawUrl.startsWith('www.')) rawUrl = 'https://' + rawUrl;
                else rawUrl = 'https://' + rawUrl;
                url = cleanUrl(rawUrl);
            }
        }

        // Extract title
        var title = '';
        var titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (titleMatch) {
            // Extract from the anchor tag inside h2 to exclude other elements
            var innerTitleMatch = titleMatch[1].match(/<a[^>]*>([\s\S]*?)<\/a>/i);
            if (innerTitleMatch) {
                title = cleanText(innerTitleMatch[1]);
            } else {
                title = cleanText(titleMatch[1]);
            }
        }

        // Extract snippet
        var snippet = '';
        if (includeSnippets) {
            // Look for snippets typically in <p> tags or <div class="b_paractl">
            var snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>|<div class="b_paractl"[^>]*>([\s\S]*?)<\/div>/i);
            if (snippetMatch) {
                snippet = cleanText(snippetMatch[1] || snippetMatch[2] || '');
            }
        }

        if (url && title && url.length > 10 && title.length > 3 && isValidUrl(url)) {
            if (!isAdResult(url, title) && !hasDuplicateUrl(results, url)) {
                results.push(buildResult(results.length + 1, title, url, snippet, 'bing'));
                foundCount++;
            }
        }

        // Find next algorithm block
        algoStart = html.indexOf('<li class="b_algo"', nextSearch);
    }
    return results;
}

function parseGoogle(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        return results;
    }

    // Improved Google search result parsing following modern structures
    // Look for <div class="g" blocks which represent results in Google modern format
    var blocks = html.split('<div class="g"');
    blocks.shift(); // Remove first element as it doesn't contain a result

    var foundCount = 0;

    for (var i = 0; i < blocks.length && results.length < limit; i++) {
        var block = blocks[i];

        // Extract title and URL from the <h3> element and its <a> tag
        var titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[\s\S]*?>([\s\S]*?)<\/a>|<a[^>]+href="(https?:\/\/[^"]+)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i);
        if (!titleMatch) continue;

        var url, title;
        if (titleMatch[1]) {
            // Pattern 1: <h3><a href="url">title</a></h3>
            url = cleanUrl(titleMatch[1]);
            title = cleanText(titleMatch[2]);
        } else {
            // Pattern 2: <a href="url"><h3>title</h3></a>
            url = cleanUrl(titleMatch[3]);
            title = cleanText(titleMatch[4]);
        }

        // Extract snippet if requested
        var snippet = '';
        if (includeSnippets) {
            // Look for class with common snippet identifiers like yDYNvb or VwiC3b or MUxRK
            var snippetMatch = block.match(/<span[^>]*class="[^"]*(?:DUTUAc|yDYNvb|VwiC3b|MUxRK)[^"]*"[^>]*>([\s\S]*?)<\/span>|<div[^>]*class="[^"]*(?:VwiC3b|MUxRK)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            if (snippetMatch) {
                snippet = cleanText(snippetMatch[1] || snippetMatch[2] || '');
            } else if (!snippet) {
                // Alternative: Look for regular text content between result blocks
                var textMatch = block.match(/<div[^>]*class="[^"]*D\(a,FAT4c,ZDlqHc,NcNeq[^"]*"[^>]*>(.*?)<\/div>/);
                if (textMatch) {
                    snippet = cleanText(textMatch[1]);
                }
            }
        }

        // Validate results before adding
        if (url && title && url.length > 10 && title.length > 3 && isValidUrl(url)) {
            if (!isAdResult(url, title) && !hasDuplicateUrl(results, url)) {
                results.push(buildResult(results.length + 1, title, url, snippet, 'google'));
                foundCount++;
            }
        }
    }
    return results;
}

function buildResult(rank, title, url, snippet, engine) {
    return {
        rank: rank,
        title: title,
        url: url,
        domain: extractDomain(url),
        snippet: snippet,
        searchEngine: engine
    };
}

function cleanUrl(url) {
    if (!url) return '';

    // Remove DuckDuckGo redirect parameters
    if (url.indexOf('uddg=') > -1) {
        var match = url.match(/uddg=([^&]+)/);
        if (match) {
            try {
                url = decodeURIComponent(match[1]);
            } catch (err) {
                // ignore decode errors
            }
        }
    }

    // Basic URL validation
    if (url.indexOf('http') === 0 && url.length > 10) {
        return url;
    }

    return '';
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDomain(url) {
    try {
        var parts = url.split('://');
        if (parts.length > 1) {
            var domain = parts[1].split('/')[0];
            return domain.replace(/^www\./, '');
        }
    } catch (err) {
        // ignore errors
    }
    return '';
}

function isValidUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    // Filter out non-HTTP URLs and common false positives
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return false;
    }

    // Filter out Google internal URLs and common false positives
    if (url.indexOf('google.com') > -1 ||
        url.indexOf('webcache') > -1 ||
        url.indexOf('search?') > -1 ||
        url.indexOf('accounts.google') > -1 ||
        url.indexOf('policies.google') > -1 ||
        url.indexOf('support.google') > -1) {
        return false;
    }

    return true;
}

function isAdResult(url, title) {
    if (/\b(?:ad|ads|sponsored|promoted|advertisement|paid partner|coupon)\b/i.test(String(title || ''))) {
        return true;
    }

    var adDomains = [
        'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
        'amazon-adsystem.com', 'facebook.com/tr', '/track?', '/click?'
    ];

    var lowerUrl = String(url || '').toLowerCase();
    for (var j = 0; j < adDomains.length; j++) {
        if (lowerUrl.indexOf(adDomains[j]) !== -1) {
            return true;
        }
    }

    return false;
}

function hasDuplicateUrl(results, url) {
    for (var i = 0; i < results.length; i++) {
        if (results[i].url === url) {
            return true;
        }
    }
    return false;
}

function extractSnippetNearMatch(html, matchIndex, includeSnippets) {
    if (!includeSnippets || !html || typeof html !== 'string') {
        return '';
    }

    // Extract text around the match position to find snippet
    var start = Math.max(0, matchIndex - 500);
    var end = Math.min(html.length, matchIndex + 1000);
    var context = html.substring(start, end);

    // Look for description/snippet patterns
    var snippetPatterns = [
        /<span[^>]*class="[^"]*st[^"]*"[^>]*>([^<]+)<\/span>/i, // Google snippet
        /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([^<]+)<\/p>/i, // Bing snippet
        /<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/span>/i, // DuckDuckGo snippet
        /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([^<]+)<\/div>/i, // Generic snippet
        /<p[^>]*>([^<]{50,200})<\/p>/i // Generic paragraph
    ];

    for (var i = 0; i < snippetPatterns.length; i++) {
        var match = context.match(snippetPatterns[i]);
        if (match && match[1]) {
            var snippet = cleanText(match[1]);
            if (snippet.length > 30) {
                return snippet.length > 200 ? snippet.substring(0, 200) + '...' : snippet;
            }
        }
    }

    // Fallback: extract any meaningful text
    var textContent = context.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textContent.length > 50) {
        var sentences = textContent.split('.').filter(function(s) { return s.trim().length > 20; });
        if (sentences.length > 0) {
            var snippet = sentences[0].trim();
            return snippet.length > 150 ? snippet.substring(0, 150) + '...' : snippet;
        }
    }

    return '';
}

function buildQueryString(params) {
    var parts = [];
    for (var key of Object.keys(params)) {
        if (Object.hasOwn(params, key) && params[key] !== undefined && params[key] !== null) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
    }
    return parts.join('&');
}

function buildSearchUrl(engine, path, params, config) {
    var query = buildQueryString(params);
    var baseUrl = config.engineBaseUrls[engine] || config.baseUrl;
    if (baseUrl) {
        return joinValidatedUrl(baseUrl, path) + (query ? '?' + query : '');
    }

    var defaultBases = {
        duckduckgo: 'https://duckduckgo.com',
        bing: 'https://www.bing.com',
        google: 'https://www.google.com'
    };
    return joinValidatedUrl(defaultBases[engine], path) + (query ? '?' + query : '');
}

function normalizeBaseUrl(value, allowPrivateHosts) {
    var text = String(value || '').trim();
    if (!text) {
        throw new Error('baseUrl must not be empty');
    }
    var parsed;
    try {
        parsed = new URL(text);
    } catch (_err) {
        throw new Error('baseUrl must be a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('baseUrl must use http or https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('baseUrl must not embed credentials');
    }
    if (!allowPrivateHosts && isBlockedHost(parsed.hostname)) {
        throw new Error('baseUrl must not point to a private or internal host');
    }
    return parsed.toString().replace(/\/+$/, '');
}

function normalizeEngineBaseUrls(value, allowPrivateHosts) {
    var result = Object.create(null);
    if (!isPlainObject(value)) {
        return result;
    }
    ['duckduckgo', 'bing', 'google'].forEach(function(engine) {
        if (Object.hasOwn(value, engine) && value[engine]) {
            result[engine] = normalizeBaseUrl(value[engine], allowPrivateHosts);
        }
    });
    return result;
}

function joinValidatedUrl(baseUrl, path) {
    return String(baseUrl).replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '');
}

function normalizeHeaders(value) {
    var headers = Object.create(null);
    if (!isPlainObject(value)) {
        return headers;
    }
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!Object.hasOwn(value, key) || !isSafeKey(key)) continue;
        var item = value[key];
        if (item === undefined || item === null) continue;
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n\0]/.test(String(item))) {
            throw new Error('Invalid header \'' + key + '\'');
        }
        headers[key] = String(item);
    }
    return headers;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function mergeObjects(base, extra) {
    var result = Object.create(null);
    var baseKeys = isPlainObject(base) ? Object.keys(base) : [];
    for (var i = 0; i < baseKeys.length; i++) {
        var key = baseKeys[i];
        if (Object.hasOwn(base, key) && isSafeKey(key)) {
            result[key] = base[key];
        }
    }
    var extraKeys = isPlainObject(extra) ? Object.keys(extra) : [];
    for (var j = 0; j < extraKeys.length; j++) {
        var extraKey = extraKeys[j];
        if (Object.hasOwn(extra, extraKey) && isSafeKey(extraKey)) {
            result[extraKey] = extra[extraKey];
        }
    }
    return result;
}

function isBlockedHost(hostname) {
    var normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
    if (normalized.indexOf(':') !== -1) {
        var clean = normalized.split('%')[0];
        var hextets = parseIpv6Hextets(clean);
        if (!hextets) return true;
        var allZero = hextets.every(function(part) { return part === 0; });
        var isLoopback = hextets.slice(0, 7).every(function(part) { return part === 0; }) && hextets[7] === 1;
        if (allZero || isLoopback) return true;
        if ((hextets[0] & 0xffc0) === 0xfe80) return true;
        if ((hextets[0] & 0xfe00) === 0xfc00) return true;
        if (hextets.slice(0, 5).every(function(part) { return part === 0; }) && hextets[5] === 0xffff) return true;
        return false;
    }
    var ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    var a = Number(ipv4[1]);
    var b = Number(ipv4[2]);
    var c = Number(ipv4[3]);
    var d = Number(ipv4[4]);
    if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) return true;
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
    var halves = address.split('::');
    if (halves.length > 2) return null;
    function parsePart(part) {
        if (!part) return [];
        var tokens = part.split(':');
        var out = [];
        for (var i = 0; i < tokens.length; i += 1) {
            var token = tokens[i];
            if (!token) return null;
            if (token.indexOf('.') !== -1) {
                if (i !== tokens.length - 1) return null;
                var v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
                if (!v4) return null;
                var octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
                if (octets.some(function(o) { return o < 0 || o > 255; })) return null;
                out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
            } else {
                if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
                out.push(parseInt(token, 16));
            }
        }
        return out;
    }
    var left = parsePart(halves[0]);
    if (!left) return null;
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    var right = parsePart(halves[1]);
    if (!right) return null;
    var missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return left.concat(new Array(missing).fill(0), right);
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

async function readBoundedText(response, maxBytes) {
    if (response && response.body && typeof response.body.getReader === 'function') {
        var reader = response.body.getReader();
        var decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
        var out = '';
        var totalBytes = 0;
        try {
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                if (!chunk.value) continue;
                if (totalBytes + chunk.value.byteLength > maxBytes) {
                    throw new Error('Search response exceeds ' + maxBytes + ' byte limit');
                }
                out += decoder ? decoder.decode(chunk.value, { stream: true }) : String.fromCharCode.apply(null, chunk.value);
                totalBytes += chunk.value.byteLength;
            }
        } finally {
            try { await reader.cancel(); } catch (_err) {}
        }
        if (decoder) out += decoder.decode();
        return out;
    }
    var text = await response.text();
    if (typeof text === 'string' && text.length > maxBytes) {
        throw new Error('Search response exceeds ' + maxBytes + ' byte limit');
    }
    return text || '';
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error('Global fetch API is unavailable. Please run @maitask/' + packageName + ' on Node.js 18 or newer.');
    }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
