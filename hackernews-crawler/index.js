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
 * @version 0.1.0
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
    console.log('Hacker News Crawler - Starting crawl');

    var config = buildConfig(input, options, context);
    var ids = await fetchStoryIds(config.storyType);
    if (!ids || !ids.length) {
        throw new Error('No story identifiers returned from Hacker News API');
    }

    var limitedIds = ids.slice(0, config.limit);
    var stories = [];
    for (var i = 0; i < limitedIds.length; i++) {
        var storyData = await fetchItem(limitedIds[i]);
        if (!storyData || storyData.type !== 'story') {
            continue;
        }
        var story = normalizeStory(storyData);
        if (config.includeComments && Array.isArray(storyData.kids) && storyData.kids.length > 0) {
            story.comments = await fetchComments(storyData.kids, config.commentLimit, config.commentDepth);
        }
        stories.push(story);
    }

    var metadata = {
        storyType: config.storyType,
        fetchedAt: new Date().toISOString(),
        requested: config.limit,
        delivered: stories.length
    };

    return {
        success: true,
        message: 'Successfully fetched stories from Hacker News',
        data: {
            storyType: config.storyType,
            totalStories: stories.length,
            stories: stories
        },
        metadata: metadata
    };
}

function buildConfig(input, options, context) {
    var source = isPlainObject(options) ? options : {};
    if (isPlainObject(input)) {
        source = mergeObjects(source, input);
    }
    if (context && isPlainObject(context.defaults)) {
        source = mergeObjects(context.defaults, source);
    }

    var limit = typeof source.limit === 'number' ? source.limit : 30;
    if (limit < 1) {
        limit = 1;
    }
    if (limit > 100) {
        limit = 100;
    }

    return {
        storyType: (source.storyType || 'top').toLowerCase(),
        limit: limit,
        includeComments: Boolean(source.includeComments),
        commentLimit: typeof source.commentLimit === 'number' ? source.commentLimit : 5,
        commentDepth: typeof source.commentDepth === 'number' ? source.commentDepth : 1
    };
}

async function fetchStoryIds(type) {
    var endpoint = 'https://hacker-news.firebaseio.com/v0/' + type + 'stories.json';
    var response = await requestJson(endpoint, { headers: { Accept: 'application/json' } });
    if (!Array.isArray(response)) {
        throw new Error('Unexpected response when fetching story identifiers');
    }
    return response;
}

async function fetchItem(id) {
    var endpoint = 'https://hacker-news.firebaseio.com/v0/item/' + id + '.json';
    return await requestJson(endpoint, { headers: { Accept: 'application/json' } });
}

async function fetchComments(ids, limit, depth) {
    var effectiveLimit = typeof limit === 'number' && limit > 0 ? limit : ids.length;
    var commentDepth = typeof depth === 'number' && depth > 0 ? depth : 1;
    var selected = ids.slice(0, effectiveLimit);
    var comments = [];

    for (var i = 0; i < selected.length; i++) {
        var rawComment = await fetchItem(selected[i]);
        if (!rawComment || rawComment.type !== 'comment') {
            continue;
        }
        var comment = normalizeComment(rawComment);
        if (commentDepth > 1 && Array.isArray(rawComment.kids) && rawComment.kids.length > 0) {
            comment.children = await fetchComments(rawComment.kids, limit, commentDepth - 1);
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
        var legacy = httpGet(url, requestOptions || {});
        validateHttpResponse(legacy, url);
        if (legacy.data !== undefined) {
            return legacy.data;
        }
        return parseJson(legacy.body, url);
    }

    if (typeof fetch === 'function') {
        var res = await fetch(url, {
            method: 'GET',
            headers: (requestOptions && requestOptions.headers) || { Accept: 'application/json' }
        });
        if (!res.ok) {
            throw new Error('Request to ' + url + ' failed with status ' + res.status);
        }
        return await res.json();
    }

    throw new Error('No HTTP client available to perform request');
}

function validateHttpResponse(response, url) {
    if (!response) {
        throw new Error('Empty HTTP response from ' + url);
    }
    if (response.status && response.status >= 400) {
        var message = response.statusText || 'HTTP ' + response.status;
        throw new Error(message + ' when calling ' + url);
    }
}

function parseJson(body, url) {
    if (!body) {
        return null;
    }
    try {
        return JSON.parse(body);
    } catch (err) {
        throw new Error('Failed to parse JSON response from ' + url);
    }
}

function mergeObjects(base, extra) {
    var target = {};
    var keys = Object.keys(base || {});
    for (var i = 0; i < keys.length; i++) {
        target[keys[i]] = base[keys[i]];
    }
    var extraKeys = Object.keys(extra || {});
    for (var j = 0; j < extraKeys.length; j++) {
        target[extraKeys[j]] = extra[extraKeys[j]];
    }
    return target;
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

execute;
