async function execute(input, options, context) {
    console.log('Web Search - Starting search');

    ensureFetch('web-search');

    var config = buildConfig(input, options, context);
    if (!config.query) {
        throw new Error('Search query is required');
    }

    console.log('Performing search with query:', config.query);

    try {
        var searchResult = await performSearch(config);
        return {
            success: true,
            message: 'Found ' + searchResult.results.length + ' results for "' + config.query + '"',
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
            metadata: searchResult.metadata,
            pagination: searchResult.pagination || null
        };
    } catch (err) {
        console.log('Search error:', err.toString());
        return {
            success: false,
            message: 'Search failed: ' + err.toString(),
            error: err.toString()
        };
    }
}

function buildConfig(input, options, context) {
    var source = mergeObjects(options || {}, input || {});

    var limit = typeof source.limit === 'number' ? source.limit : 10;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;  // Allow up to 100 results

    var page = typeof source.page === 'number' ? source.page : 1;
    if (page < 1) page = 1;

    var offset = typeof source.offset === 'number' ? source.offset : (page - 1) * limit;
    if (offset < 0) offset = 0;

    return {
        query: (source.query || '').trim(),
        engine: (source.engine || 'duckduckgo').toLowerCase(),
        limit: limit,
        page: page,
        offset: offset,
        language: (source.language || 'en').toLowerCase(),
        region: (source.region || 'us').toLowerCase(),
        includeSnippets: source.includeSnippets !== false,
        safeSearch: source.safeSearch || 'moderate',
        headers: source.headers || {},
        nextPageToken: source.nextPageToken || null
    };
}

async function performSearch(config) {
    console.log('Search engine:', config.engine);

    if (config.engine === 'bing') {
        try {
            return await searchBing(config);
        } catch (err) {
            console.log('Bing search failed, falling back to DuckDuckGo:', err.message);
        }
    }

    if (config.engine === 'google') {
        try {
            return await searchGoogle(config);
        } catch (err) {
            console.log('Google search failed, falling back to DuckDuckGo:', err.message);
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

    var url = 'https://duckduckgo.com/html/?' + buildQueryString(params);

    console.log('Fetching DuckDuckGo URL:', url);

    try {
        var html = await fetchPage(url, config.headers);
        var results = parseDuckDuckGo(html, config.limit, config.includeSnippets);

        // Log if no results found
        if (results.length === 0) {
            console.log('No real results found for query:', config.query);
        }

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
        console.log('DuckDuckGo request failed:', err.message);
        return {
            engine: 'duckduckgo',
            results: [],
            metadata: { sourceUrl: url, error: err.message }
        };
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

    var url = 'https://www.bing.com/search?' + buildQueryString(params);

    console.log('Fetching Bing URL:', url);

    try {
        var html = await fetchPage(url, config.headers);
        var results = parseBing(html, config.limit, config.includeSnippets);

        // Log if no results found
        if (results.length === 0) {
            console.log('No real Bing results found for query:', config.query);
        }

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
        console.log('Bing request failed:', err.message);
        return {
            engine: 'bing',
            results: [],
            metadata: { sourceUrl: url, error: err.message }
        };
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

    var url = 'https://www.google.com/search?' + buildQueryString(params);

    console.log('Fetching Google URL:', url);

    try {
        var html = await fetchPage(url, config.headers);
        var results = parseGoogle(html, config.limit, config.includeSnippets);

        // Log if no results found
        if (results.length === 0) {
            console.log('No real Google results found for query:', config.query);
        }

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
        console.log('Google request failed:', err.message);
        return {
            engine: 'google',
            results: [],
            metadata: { sourceUrl: url, error: err.message }
        };
    }
}

async function fetchPage(url, headers) {
    var requestHeaders = mergeObjects({
        'User-Agent': 'Mozilla/5.0 (compatible; MaitaskWebSearch/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    }, headers || {});

    console.log('Making HTTP request to:', url);

    var response = await fetch(url, {
        method: 'GET',
        headers: requestHeaders
    });

    var body = await response.text();
    console.log('HTTP response received, status:', response.status, 'body length:', body ? body.length : 0);

    if (!response.ok) {
        throw new Error('Request to ' + url + ' failed with status ' + response.status);
    }

    return body || '';
}

// Parse DuckDuckGo search results with improved accuracy
function parseDuckDuckGo(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        console.log('Invalid HTML received for DuckDuckGo');
        return results;
    }

    console.log('Parsing DuckDuckGo HTML, length:', html.length);

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
        var titleMatch = block.match(/<h2[^>]*>(.*?)<\/h2>/);
        if (!titleMatch) continue;
        var title = cleanText(titleMatch[1]);

        // Extract snippet
        var snippet = '';
        if (includeSnippets) {
            var snippetMatch = block.match(/<a[^>]*>(.*?)<\/a>.*?<div[^>]*>(.*?)<\/div>|<div class="result__snippet"[^>]*>(.*?)<\/div>/);
            if (snippetMatch) {
                snippet = cleanText(snippetMatch[2] || snippetMatch[3] || snippetMatch[1] || '');
            }
        }

        if (url && title && url.length > 10 && title.length > 3 && isValidUrl(url)) {
            if (!isAdResult(url, title) && !hasDuplicateUrl(results, url)) {
                results.push(buildResult(rank++, title, url, snippet, 'duckduckgo'));
                foundCount++;
            }
        }
    }

    console.log('DuckDuckGo parsing completed, found:', foundCount, 'valid results out of', resultBlocks.length, 'potential blocks');
    return results;
}

function parseBing(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        console.log('Invalid HTML received for Bing');
        return results;
    }

    console.log('Parsing Bing HTML, length:', html.length);

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
        var urlMatch = block.match(/<h2[^>]*>.*?<a[^>]+href="(https?:\/\/[^"]+)"/);
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
        var titleMatch = block.match(/<h2[^>]*>(.*?)<\/h2>/);
        if (titleMatch) {
            // Extract from the anchor tag inside h2 to exclude other elements
            var innerTitleMatch = titleMatch[1].match(/<a[^>]*>(.*?)<\/a>/);
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
            var snippetMatch = block.match(/<p[^>]*>(.*?)<\/p>|<div class="b_paractl"[^>]*>(.*?)<\/div>/);
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

    console.log('Bing parsing completed, found:', foundCount, 'valid results out of potential blocks');
    return results;
}

function parseGoogle(html, limit, includeSnippets) {
    var results = [];
    if (!html || typeof html !== 'string') {
        console.log('Invalid HTML received for Google');
        return results;
    }

    console.log('Parsing Google HTML, length:', html.length);

    // Improved Google search result parsing following modern structures
    // Look for <div class="g" blocks which represent results in Google modern format
    var blocks = html.split('<div class="g"');
    blocks.shift(); // Remove first element as it doesn't contain a result

    var foundCount = 0;

    for (var i = 0; i < blocks.length && results.length < limit; i++) {
        var block = blocks[i];

        // Extract title and URL from the <h3> element and its <a> tag
        var titleMatch = block.match(/<h3[^>]*>.*?<a[^>]+href="(https?:\/\/[^"]+)".*?>(.*?)<\/a>|<a[^>]+href="(https?:\/\/[^"]+)".*?<h3[^>]*>(.*?)<\/h3>/);
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
            var snippetMatch = block.match(/<span[^>]*class="[^"]*DUTUAc|yDYNvb|VwiC3b|MUxRK[^"]*"[^>]*>(.*?)<\/span>|<div[^>]*class="[^"]*VwiC3b|MUxRK[^"]*"[^>]*>(.*?)<\/div>/);
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

    console.log('Google parsing completed, found:', foundCount, 'valid results out of', blocks.length, 'potential blocks');
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
    // Check for promotional, sponsored or ad labels in title/text
    var adIndicators = [
        'ad', 'sponsored', 'promoted', 'advertisement',
        'paid', 'partner', 'shop', 'buy', 'price', 'coupon'
    ];

    var lowerTitle = title.toLowerCase();
    for (var i = 0; i < adIndicators.length; i++) {
        if (lowerTitle.indexOf(adIndicators[i]) !== -1) {
            return true;
        }
    }

    // Check if URL indicates an ad/tracking domain
    var adDomains = [
        'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
        'amazon-adsystem.com', 'facebook.com/tr', 'track', 'click'
    ];

    var lowerUrl = url.toLowerCase();
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
    for (var key in params) {
        if (params[key] !== undefined && params[key] !== null) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
    }
    return parts.join('&');
}


function mergeObjects(base, extra) {
    var result = {};
    for (var key in base) {
        result[key] = base[key];
    }
    for (var key in extra) {
        result[key] = extra[key];
    }
    return result;
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error('Global fetch API is unavailable. Please run @maitask/' + packageName + ' on Node.js 18 or newer.');
    }
}

execute;
