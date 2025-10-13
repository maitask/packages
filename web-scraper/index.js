async function execute(input, options = {}, context = {}) {
    ensureFetch('web-scraper');
    const targets = normalizeTargets(input);
    const results = [];

    for (const target of targets) {
        try {
            const scraped = await scrapeTarget(target, options);
            results.push(scraped);
        } catch (error) {
            results.push({
                url: typeof target === 'object' && target !== null ? target.url : target,
                success: false,
                error: error.message || String(error)
            });
        }
    }

    return {
        success: true,
        total: results.length,
        results,
        timestamp: new Date().toISOString()
    };
}

async function scrapeTarget(target, options) {
    const descriptor = typeof target === 'object' && target !== null ? target : { url: target };
    if (!descriptor.url) {
        throw new Error('Target url is required');
    }

    const response = await fetchHtml(descriptor.url, options.headers || {});
    if (!response.ok) {
        return {
            url: descriptor.url,
            success: false,
            status: response.status,
            error: response.statusText || 'Request failed'
        };
    }

    const body = response.body;
    const html = options.preserveWhitespace ? body : body.replace(/\s+/g, ' ').trim();

    // Parse custom selectors (CSS and XPath)
    var customData = {};
    if (options.selectors || options.xpath) {
        customData = extractCustomSelectors(html, {
            css: options.selectors || {},
            xpath: options.xpath || {}
        });
    }

    return {
        url: descriptor.url,
        label: descriptor.label || descriptor.name || null,
        status: response.status,
        success: true,
        title: extractTag(html, 'title'),
        meta: {
            description: extractMeta(html, 'description'),
            keywords: extractMeta(html, 'keywords'),
            author: extractMeta(html, 'author')
        },
        headings: extractHeadings(html, options.headingLevels),
        links: extractLinks(html, options.linkFilters),
        patterns: evaluatePatterns(html, options.patterns),
        customData: customData,
        fetchedAt: new Date().toISOString()
    };
}

function normalizeTargets(input) {
    if (input === null || input === undefined) return [];
    const list = Array.isArray(input) ? input : [input];
    return list
        .map(item => {
            if (typeof item === 'string') {
                return { url: item };
            }
            if (typeof item === 'object' && item !== null) {
                return { url: item.url || item.href || null, label: item.label || item.name || null };
            }
            return { url: null };
        })
        .filter(entry => !!entry.url);
}

function extractTag(html, tag) {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'i');
    const match = html.match(regex);
    return match ? decodeEntities(match[1]) : null;
}

function extractMeta(html, name) {
    const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["'](.*?)["'][^>]*>`, 'i');
    const match = html.match(regex);
    return match ? decodeEntities(match[1]) : null;
}

function extractHeadings(html, levels) {
    const allowed = Array.isArray(levels) && levels.length ? levels.map(level => String(level).toLowerCase()) : ['h1', 'h2', 'h3'];
    const result = [];
    const regex = /<(h[1-6])[^>]*>(.*?)<\/\1>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        if (allowed.indexOf(match[1].toLowerCase()) === -1) continue;
        result.push({
            level: match[1].toLowerCase(),
            text: decodeEntities(stripTags(match[2]))
        });
    }
    return result;
}

function extractLinks(html, filter) {
    const result = [];
    const seen = new Set();
    const regex = /<a[^>]+href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const href = match[1];
        if (!href || seen.has(href)) continue;
        if (filter && filter.include && !filter.include.some(pattern => href.indexOf(pattern) !== -1)) continue;
        if (filter && filter.exclude && filter.exclude.some(pattern => href.indexOf(pattern) !== -1)) continue;
        seen.add(href);
        result.push({ href, text: decodeEntities(stripTags(match[2])) });
    }
    return result;
}

function evaluatePatterns(html, patterns) {
    if (!Array.isArray(patterns) || !patterns.length) return [];
    return patterns.map(entry => {
        const item = typeof entry === 'string' ? { name: entry, pattern: entry } : (entry || {});
        if (!item.pattern) {
            return { name: item.name || 'pattern', matches: [] };
        }
        try {
            const regex = new RegExp(item.pattern, item.flags || 'gi');
            const matches = [];
            let match;
            while ((match = regex.exec(html)) !== null) {
                matches.push(match[0]);
                if (!regex.global) break;
            }
            return { name: item.name || item.pattern, matches };
        } catch (error) {
            return { name: item.name || item.pattern || 'pattern', error: error.message, matches: [] };
        }
    });
}

function stripTags(value) {
    return value.replace(/<[^>]*>/g, '').trim();
}

function decodeEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractCustomSelectors(html, config) {
    var result = {};

    // Process CSS selectors
    if (config.css && typeof config.css === 'object') {
        for (var key in config.css) {
            try {
                result[key] = extractByCSS(html, config.css[key]);
            } catch (error) {
                result[key] = { error: error.message, value: null };
            }
        }
    }

    // Process XPath selectors
    if (config.xpath && typeof config.xpath === 'object') {
        for (var key in config.xpath) {
            try {
                result[key] = extractByXPath(html, config.xpath[key]);
            } catch (error) {
                result[key] = { error: error.message, value: null };
            }
        }
    }

    return result;
}

function extractByCSS(html, selector) {
    // Simple CSS selector support (tag, class, id)
    var results = [];

    if (typeof selector === 'string') {
        // Support basic selectors
        if (selector.startsWith('.')) {
            // Class selector
            var className = selector.substring(1);
            var regex = new RegExp('<[^>]+class=["\'][^"\']*\\b' + escapeRegex(className) + '\\b[^"\']*["\'][^>]*>([\\s\\S]*?)</[^>]+>', 'gi');
            var match;
            while ((match = regex.exec(html)) !== null) {
                results.push(stripTags(match[1]));
            }
        } else if (selector.startsWith('#')) {
            // ID selector
            var id = selector.substring(1);
            var regex = new RegExp('<[^>]+id=["\'  ]' + escapeRegex(id) + '["\'][^>]*>([\\s\\S]*?)</[^>]+>', 'i');
            var match = html.match(regex);
            if (match) {
                results.push(stripTags(match[1]));
            }
        } else {
            // Tag selector
            var regex = new RegExp('<' + escapeRegex(selector) + '[^>]*>([\\s\\S]*?)</' + escapeRegex(selector) + '>', 'gi');
            var match;
            while ((match = regex.exec(html)) !== null) {
                results.push(stripTags(match[1]));
            }
        }
    }

    return results.length > 0 ? results : null;
}

function extractByXPath(html, xpath) {
    // Simplified XPath implementation for common patterns
    // Supports: //tag, //tag[@attr='value'], //tag/text(), //*[@attr='value']

    var results = [];

    // Parse XPath expression
    if (typeof xpath !== 'string') {
        return null;
    }

    // Handle //tag pattern
    var tagMatch = xpath.match(/^\/\/(\w+)(?:\[([^\]]+)\])?(?:\/(text\(\)|@\w+))?$/);
    if (tagMatch) {
        var tag = tagMatch[1];
        var predicate = tagMatch[2];
        var selector = tagMatch[3];

        // Build regex for tag
        var pattern = '<' + escapeRegex(tag) + '([^>]*)>([\\s\\S]*?)</' + escapeRegex(tag) + '>';
        var regex = new RegExp(pattern, 'gi');
        var match;

        while ((match = regex.exec(html)) !== null) {
            var attributes = match[1];
            var content = match[2];

            // Check predicate if present
            if (predicate) {
                var attrMatch = predicate.match(/@(\w+)=["']([^"']+)["']/);
                if (attrMatch) {
                    var attrName = attrMatch[1];
                    var attrValue = attrMatch[2];
                    var attrRegex = new RegExp('\\b' + escapeRegex(attrName) + '=["\']' + escapeRegex(attrValue) + '["\'  ]');
                    if (!attrRegex.test(attributes)) {
                        continue;
                    }
                }
            }

            // Extract value based on selector
            if (selector === 'text()') {
                results.push(stripTags(content));
            } else if (selector && selector.startsWith('@')) {
                var attrName = selector.substring(1);
                var attrRegex = new RegExp('\\b' + escapeRegex(attrName) + '=["\'  ]([^"\']+)["\'  ]');
                var attrMatch = attributes.match(attrRegex);
                if (attrMatch) {
                    results.push(decodeEntities(attrMatch[1]));
                }
            } else {
                results.push(stripTags(content));
            }
        }
    }

    // Handle //*[@attr='value'] pattern
    var wildcardMatch = xpath.match(/^\/\/\*\[@(\w+)=["']([^"']+)["']\](?:\/(text\(\)|@\w+))?$/);
    if (wildcardMatch) {
        var attrName = wildcardMatch[1];
        var attrValue = wildcardMatch[2];
        var selector = wildcardMatch[3];

        var pattern = '<(\\w+)([^>]*\\b' + escapeRegex(attrName) + '=["\'  ]' + escapeRegex(attrValue) + '["\'][^>]*)>([\\s\\S]*?)</\\1>';
        var regex = new RegExp(pattern, 'gi');
        var match;

        while ((match = regex.exec(html)) !== null) {
            var attributes = match[2];
            var content = match[3];

            if (selector === 'text()') {
                results.push(stripTags(content));
            } else if (selector && selector.startsWith('@')) {
                var extractAttr = selector.substring(1);
                var attrRegex = new RegExp('\\b' + escapeRegex(extractAttr) + '=["\'  ]([^"\']+)["\'  ]');
                var attrMatch = attributes.match(attrRegex);
                if (attrMatch) {
                    results.push(decodeEntities(attrMatch[1]));
                }
            } else {
                results.push(stripTags(content));
            }
        }
    }

    return results.length > 0 ? results : null;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchHtml(url, headers) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MaitaskWebScraper/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            ...headers
        }
    });

    const body = await response.text();

    return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        body
    };
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is unavailable. Please run @maitask/${packageName} on Node.js 18 or newer.`);
    }
}

execute;
