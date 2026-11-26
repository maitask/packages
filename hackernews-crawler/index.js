/**
 * @maitask/hackernews-crawler
 * Crawl and extract stories from Hacker News using official API
 *
 * Features:
 * - Story fetching (top, new, best, ask, show, job)
 * - Comment tree crawling with depth control
 * - Configurable limits and depth
 * - Story normalization and metadata
 * - Async API integration
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for HackerNews crawling
 * @param {Object} input - Crawling configuration
 * @param {Object} options - Crawling options and limits
 * @param {Object} context - Execution context
 * @returns {Object} Crawled stories with comments
 */
async function execute(input, options, context) {
    try {
        var config = buildConfig(input, options, context);
        var ids = await fetchStoryIds(config);
        if (!ids || !ids.length) {
            throw new Error('No story identifiers returned from Hacker News API');
        }

        var limitedIds = ids.slice(0, config.limit);
        var stories = [];
        for (var i = 0; i < limitedIds.length; i++) {
            var storyData = await fetchItem(limitedIds[i], config);
            if (!storyData || storyData.type !== 'story') {
                continue;
            }
            var story = normalizeStory(storyData);
            if (config.includeComments && config.commentLimit > 0 && config.commentDepth > 0 && Array.isArray(storyData.kids) && storyData.kids.length > 0) {
                story.comments = await fetchComments(storyData.kids, config.commentLimit, config.commentDepth, config);
            }
            stories.push(story);
        }

        var metadata = {
            package: '@maitask/hackernews-crawler',
            version: '0.1.1',
            provider: 'hackernews',
            storyType: config.storyType,
            fetchedAt: new Date().toISOString(),
            requested: config.limit,
            delivered: stories.length
        };

        return {
            success: true,
            data: {
                storyType: config.storyType,
                totalStories: stories.length,
                stories: stories
            },
            metadata: metadata
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: sanitizeErrorMessage(error) || 'Hacker News crawl failed',
                code: 'HACKERNEWS_CRAWLER_ERROR',
                type: error.name || 'HackerNewsCrawlerError'
            },
            metadata: {
                package: '@maitask/hackernews-crawler',
                version: '0.1.1',
                provider: 'hackernews',
                fetchedAt: new Date().toISOString()
            }
        };
    }
}

function buildConfig(input, options, context) {
    var safeOptions = isPlainObject(options) ? options : {};
    var safeInput = isPlainObject(input) ? input : {};
    if (safeInput.apiBaseUrl !== undefined || safeInput.baseUrl !== undefined) {
        throw new Error('apiBaseUrl and baseUrl must be configured via options or context.env, not input');
    }

    var trusted = context && isPlainObject(context.defaults)
        ? mergeObjects(context.defaults, safeOptions)
        : mergeObjects({}, safeOptions);
    if (context && isPlainObject(context.env) && context.env.HACKERNEWS_API_BASE_URL && !trusted.apiBaseUrl && !trusted.baseUrl) {
        trusted.apiBaseUrl = context.env.HACKERNEWS_API_BASE_URL;
    }

    var source = mergeObjects(trusted, {
        storyType: safeInput.storyType !== undefined ? safeInput.storyType : trusted.storyType,
        limit: safeInput.limit !== undefined ? safeInput.limit : trusted.limit,
        includeComments: safeInput.includeComments !== undefined ? safeInput.includeComments : trusted.includeComments,
        commentLimit: safeInput.commentLimit !== undefined ? safeInput.commentLimit : trusted.commentLimit,
        commentDepth: safeInput.commentDepth !== undefined ? safeInput.commentDepth : trusted.commentDepth
    });

    var limit = typeof source.limit === 'number' ? source.limit : 30;
    if (limit < 1) {
        limit = 1;
    }
    if (limit > 100) {
        limit = 100;
    }

    var storyType = String(source.storyType || 'top').toLowerCase();
    var allowedStoryTypes = ['top', 'new', 'best', 'ask', 'show', 'job'];
    if (allowedStoryTypes.indexOf(storyType) === -1) {
        throw new Error('Unsupported storyType "' + storyType + '". Use one of: ' + allowedStoryTypes.join(', '));
    }

    var commentLimit = typeof source.commentLimit === 'number' ? source.commentLimit : 5;
    if (commentLimit < 0) {
        commentLimit = 0;
    }
    if (commentLimit > 100) {
        commentLimit = 100;
    }

    var commentDepth = typeof source.commentDepth === 'number' ? source.commentDepth : 1;
    if (commentDepth < 0) {
        commentDepth = 0;
    }
    if (commentDepth > 10) {
        commentDepth = 10;
    }

    var rawTimeout = Number(trusted.timeoutMs);
    var timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
        ? Math.min(Math.max(Math.trunc(rawTimeout), 1000), 120000)
        : 30000;
    var allowPrivateHosts = trusted.allowPrivateHosts === true;

    return {
        storyType: storyType,
        apiBaseUrl: normalizeBaseUrl(trusted.apiBaseUrl || trusted.baseUrl || 'https://hacker-news.firebaseio.com/v0', allowPrivateHosts),
        limit: limit,
        includeComments: Boolean(source.includeComments),
        commentLimit: commentLimit,
        commentDepth: commentDepth,
        timeoutMs: timeoutMs
    };
}

async function fetchStoryIds(config) {
    var endpoint = config.apiBaseUrl + '/' + config.storyType + 'stories.json';
    var response = await requestJson(endpoint, { headers: { Accept: 'application/json' }, timeoutMs: config.timeoutMs });
    if (!Array.isArray(response)) {
        throw new Error('Unexpected response when fetching story identifiers');
    }
    return response;
}

async function fetchItem(id, config) {
    var endpoint = config.apiBaseUrl + '/item/' + encodeURIComponent(String(id)) + '.json';
    return await requestJson(endpoint, { headers: { Accept: 'application/json' }, timeoutMs: config.timeoutMs });
}

async function fetchComments(ids, limit, depth, config) {
    var effectiveLimit = typeof limit === 'number' && limit >= 0 ? limit : ids.length;
    var commentDepth = typeof depth === 'number' && depth > 0 ? depth : 0;
    if (effectiveLimit === 0 || commentDepth === 0) {
        return [];
    }
    var selected = ids.slice(0, effectiveLimit);
    var comments = [];

    for (var i = 0; i < selected.length; i++) {
        var rawComment = await fetchItem(selected[i], config);
        if (!rawComment || rawComment.type !== 'comment') {
            continue;
        }
        var comment = normalizeComment(rawComment);
        if (commentDepth > 1 && Array.isArray(rawComment.kids) && rawComment.kids.length > 0) {
            comment.children = await fetchComments(rawComment.kids, limit, commentDepth - 1, config);
        }
        comments.push(comment);
    }

    return comments;
}

function normalizeStory(raw) {
    return {
        id: raw.id,
        title: raw.title,
        url: raw.url || null,
        author: raw.by,
        score: raw.score || 0,
        time: new Date(raw.time * 1000).toISOString(),
        commentCount: raw.descendants || 0,
        type: raw.type,
        text: raw.text || null,
        tags: raw.tags || [],
        original: raw
    };
}

function normalizeComment(raw) {
    return {
        id: raw.id,
        author: raw.by,
        time: raw.time ? new Date(raw.time * 1000).toISOString() : null,
        text: raw.text || '',
        parent: raw.parent || null,
        deleted: Boolean(raw.deleted),
        original: raw
    };
}

async function requestJson(url, requestOptions) {
    if (typeof httpRequest === 'function') {
        var response = httpRequest('GET', url, requestOptions || {});
        validateHttpResponse(response, url);
        if (response.data !== undefined) {
            return response.data;
        }
        return parseJson(response.body, url);
    }

    if (typeof httpGet === 'function') {
        var fallback = httpGet(url, requestOptions || {});
        validateHttpResponse(fallback, url);
        if (fallback.data !== undefined) {
            return fallback.data;
        }
        return parseJson(fallback.body, url);
    }

var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

    if (typeof fetch === 'function') {
        var timeoutMs = (requestOptions && requestOptions.timeoutMs) || 30000;
        var runtimeFetch = usesMaitaskRuntimeFetch();
        var controller = runtimeFetch ? null : new AbortController();
        var timer = runtimeFetch ? null : setTimeout(function () { controller.abort(); }, timeoutMs);
        try {
            var fetchInit = {
                method: 'GET',
                headers: (requestOptions && requestOptions.headers) || { Accept: 'application/json' },
                redirect: 'manual',
                timeoutMs: timeoutMs
            };
            if (runtimeFetch) {
                fetchInit.maxResponseBytes = MAX_RESPONSE_BYTES;
            } else {
                fetchInit.signal = controller.signal;
            }
            var res = await fetch(url, fetchInit);
            if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
                if (res.body && typeof res.body.cancel === 'function') {
                    try { await res.body.cancel(); } catch (_err) {}
                }
                throw new Error('Hacker News API redirects are not allowed');
            }
            if (!res.ok) {
                if (res.body && typeof res.body.cancel === 'function') {
                    try { await res.body.cancel(); } catch (_err) {}
                }
                throw new Error('Hacker News API request failed with status ' + res.status);
            }
            var rawBody = await readBoundedText(res, MAX_RESPONSE_BYTES);
            return parseJson(rawBody, url);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error('Hacker News API request timed out after ' + timeoutMs + 'ms');
            }
            throw err;
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    }

    throw new Error('No HTTP client available to perform request');
}

function validateHttpResponse(response, url) {
    if (!response) {
        throw new Error('Empty HTTP response from Hacker News API');
    }
    if (response.status && response.status >= 400) {
        var message = response.statusText || 'HTTP ' + response.status;
        throw new Error(message + ' when calling Hacker News API');
    }
}

function parseJson(body, url) {
    if (!body) {
        return null;
    }
    try {
        return JSON.parse(body);
    } catch (err) {
        throw new Error('Failed to parse JSON response from Hacker News API');
    }
}

function isSafeKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function mergeObjects(base, extra) {
    var target = Object.create(null);
    var keys = Object.keys(base || {});
    for (var i = 0; i < keys.length; i++) {
        if (Object.hasOwn(base, keys[i]) && isSafeKey(keys[i])) {
            target[keys[i]] = base[keys[i]];
        }
    }
    var extraKeys = Object.keys(extra || {});
    for (var j = 0; j < extraKeys.length; j++) {
        if (Object.hasOwn(extra, extraKeys[j]) && isSafeKey(extraKeys[j])) {
            target[extraKeys[j]] = extra[extraKeys[j]];
        }
    }
    return target;
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBaseUrl(value, allowPrivateHosts) {
    var text = String(value || '').trim();
    if (!text) {
        throw new Error('apiBaseUrl must not be empty');
    }
    var parsed;
    try {
        parsed = new URL(text);
    } catch (_err) {
        throw new Error('apiBaseUrl must be a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('apiBaseUrl must use http or https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('apiBaseUrl must not embed credentials');
    }
    if (!allowPrivateHosts && isBlockedHost(parsed.hostname)) {
        throw new Error('apiBaseUrl must not point to a private or internal host');
    }
    return parsed.toString().replace(/\/+$/, '');
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

function sanitizeErrorMessage(error) {
    return String(error && error.message ? error.message : error || 'Hacker News crawl failed')
        .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
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
                    throw new Error('Hacker News API response exceeds ' + maxBytes + ' byte limit');
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
    if (typeof response.text === 'function') {
        var text = await response.text();
        if (typeof text === 'string' && text.length > maxBytes) {
            throw new Error('Hacker News API response exceeds ' + maxBytes + ' byte limit');
        }
        return text || '';
    }
    var jsonVal = await response.json();
    return jsonVal == null ? '' : JSON.stringify(jsonVal);
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
