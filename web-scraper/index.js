async function execute(input, options = {}, context = {}) {
    try {
        ensureFetch('web-scraper');
        const targets = normalizeTargets(input);
        if (!targets.length) {
            throw new Error('At least one target url is required');
        }

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

        const successCount = results.filter((item) => item.success).length;

        return {
            success: successCount > 0,
            data: {
                total: results.length,
                successCount,
                failureCount: results.length - successCount,
                results
            },
            metadata: {
                package: '@maitask/web-scraper',
                version: '0.1.0',
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Web scraping failed',
                code: 'WEB_SCRAPER_ERROR',
                type: error.name || 'WebScraperError'
            },
            metadata: {
                package: '@maitask/web-scraper',
                version: '0.1.0',
                timestamp: new Date().toISOString()
            }
        };
    }
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

function extractByCSS(html, selectorConfig) {
    var descriptor = typeof selectorConfig === 'object' && selectorConfig !== null
        ? selectorConfig
        : { selector: selectorConfig };
    var selector = descriptor.selector || descriptor.css || descriptor.path;
    var attr = descriptor.attr || descriptor.attribute;
    if (typeof attr === 'string') {
        attr = attr.toLowerCase();
    }
    var results = [];

    if (typeof selector !== 'string' || !selector.trim()) {
        return null;
    }

    splitSelectorList(selector).forEach(function(selectorPart) {
        var tokens = splitDescendantSelector(selectorPart);
        var elements = selectElements(html, tokens);
        elements.forEach(function(element) {
            if (attr) {
                if (Object.prototype.hasOwnProperty.call(element.attrs, attr)) {
                    results.push(decodeEntities(String(element.attrs[attr])));
                }
            } else {
                results.push(decodeEntities(getElementText(element)));
            }
        });
    });

    results = uniqueValues(results.filter(function(value) { return value !== null && value !== undefined; }));
    return results.length > 0 ? results : null;
}

function extractByXPath(html, xpath) {
    if (typeof xpath !== 'string' || !xpath.trim()) {
        return null;
    }

    var parsed = parseXPath(xpath.trim());
    if (!parsed) {
        return null;
    }

    var elements = selectXPathElements(html, parsed.segments);
    var results = elements.map(function(element) {
        if (parsed.output === 'text') {
            return decodeEntities(getElementText(element));
        }
        if (parsed.output && parsed.output.type === 'attr') {
            return Object.prototype.hasOwnProperty.call(element.attrs, parsed.output.name)
                ? decodeEntities(String(element.attrs[parsed.output.name]))
                : null;
        }
        return decodeEntities(getElementText(element));
    }).filter(function(value) {
        return value !== null && value !== undefined && value !== '';
    });

    results = uniqueValues(results);
    return results.length > 0 ? results : null;
}

function splitSelectorList(selector) {
    var parts = [];
    var current = '';
    var quote = null;
    var bracketDepth = 0;

    for (var i = 0; i < selector.length; i++) {
        var char = selector[i];

        if (quote) {
            current += char;
            if (char === quote && selector[i - 1] !== '\\') {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }

        if (char === '[') {
            bracketDepth += 1;
            current += char;
            continue;
        }

        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += char;
            continue;
        }

        if (char === ',' && bracketDepth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
}

function splitDescendantSelector(selector) {
    var steps = [];
    var current = '';
    var quote = null;
    var bracketDepth = 0;
    var nextCombinator = 'descendant';

    function pushCurrent() {
        if (!current.trim()) return;
        steps.push({
            selector: current.trim(),
            combinator: steps.length === 0 ? 'self' : nextCombinator
        });
        current = '';
        nextCombinator = 'descendant';
    }

    for (var i = 0; i < selector.length; i++) {
        var char = selector[i];

        if (quote) {
            current += char;
            if (char === quote && selector[i - 1] !== '\\') {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }

        if (char === '[') {
            bracketDepth += 1;
            current += char;
            continue;
        }

        if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            current += char;
            continue;
        }

        if (bracketDepth === 0 && char === '>') {
            pushCurrent();
            nextCombinator = 'child';
            continue;
        }

        if (bracketDepth === 0 && /\s/.test(char)) {
            pushCurrent();
            if (nextCombinator !== 'child') {
                nextCombinator = 'descendant';
            }
            continue;
        }

        current += char;
    }

    pushCurrent();
    return steps;
}

function selectElements(html, steps) {
    var root = parseHtmlTree(html);
    var contexts = [root];

    steps.forEach(function(step) {
        var criteria = parseCssSelector(step.selector || step);
        if (!criteria) {
            contexts = [];
            return;
        }

        var next = [];
        contexts.forEach(function(context) {
            var candidates = step.combinator === 'child'
                ? getElementChildren(context)
                : getDescendantElements(context);
            candidates.forEach(function(element) {
                if (matchesCssCriteria(element, criteria)) {
                    next.push(element);
                }
            });
        });
        contexts = uniqueElements(next);
    });

    return contexts;
}

function findElements(html, selector) {
    var criteria = parseCssSelector(selector);
    if (!criteria) return [];

    return getDescendantElements(parseHtmlTree(html)).filter(function(element) {
        return matchesCssCriteria(element, criteria);
    });
}

function parseHtmlTree(html) {
    var source = String(html || '');
    var root = {
        type: 'root',
        tag: '#document',
        attrs: {},
        children: [],
        parent: null,
        order: 0
    };
    var stack = [root];
    var order = 1;
    var tokenRegex = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
    var lastIndex = 0;
    var lowerHtml = source.toLowerCase();
    var match;

    function currentParent() {
        return stack[stack.length - 1] || root;
    }

    function appendText(value) {
        if (!value) return;
        currentParent().children.push({
            type: 'text',
            text: value,
            parent: currentParent(),
            order: order++
        });
    }

    while ((match = tokenRegex.exec(source)) !== null) {
        appendText(source.slice(lastIndex, match.index));

        var token = match[0];
        lastIndex = tokenRegex.lastIndex;

        if (token.indexOf('<!--') === 0 || /^<!doctype/i.test(token)) {
            continue;
        }

        if (token.indexOf('<![CDATA[') === 0) {
            appendText(token.slice(9, -3));
            continue;
        }

        var closingMatch = token.match(/^<\s*\/\s*([a-zA-Z][\w:-]*)\s*>$/);
        if (closingMatch) {
            closeElement(closingMatch[1].toLowerCase(), stack);
            continue;
        }

        var openMatch = token.match(/^<\s*([a-zA-Z][\w:-]*)([\s\S]*?)>$/);
        if (!openMatch) {
            appendText(token);
            continue;
        }

        var tag = openMatch[1].toLowerCase();
        var rawAttributes = openMatch[2] || '';
        var selfClosing = isVoidElement(tag) || /\/\s*>$/.test(token);
        var element = {
            type: 'element',
            tag: tag,
            attrs: parseAttributes(rawAttributes),
            children: [],
            parent: currentParent(),
            order: order++
        };

        currentParent().children.push(element);

        if (isRawTextElement(tag) && !selfClosing) {
            var closeStart = lowerHtml.indexOf('</' + tag, tokenRegex.lastIndex);
            if (closeStart !== -1) {
                var closeEnd = lowerHtml.indexOf('>', closeStart);
                if (closeEnd !== -1) {
                    var rawText = source.slice(tokenRegex.lastIndex, closeStart);
                    if (rawText) {
                        element.children.push({
                            type: 'text',
                            text: rawText,
                            parent: element,
                            order: order++
                        });
                    }
                    tokenRegex.lastIndex = closeEnd + 1;
                    lastIndex = tokenRegex.lastIndex;
                }
            }
            continue;
        }

        if (!selfClosing) {
            stack.push(element);
        }
    }

    appendText(source.slice(lastIndex));
    return root;
}

function closeElement(tag, stack) {
    for (var i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
            stack.length = i;
            return;
        }
    }
}

function isVoidElement(tag) {
    return /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag);
}

function isRawTextElement(tag) {
    return /^(script|style|textarea|title)$/i.test(tag);
}

function getElementChildren(node) {
    return (node.children || []).filter(function(child) {
        return child.type === 'element';
    });
}

function getDescendantElements(node) {
    var result = [];

    function visit(current) {
        (current.children || []).forEach(function(child) {
            if (child.type !== 'element') return;
            result.push(child);
            visit(child);
        });
    }

    visit(node);
    return result;
}

function getElementText(node) {
    var parts = [];

    function visit(current) {
        (current.children || []).forEach(function(child) {
            if (child.type === 'text') {
                parts.push(child.text);
                return;
            }
            if (child.type === 'element') {
                visit(child);
            }
        });
    }

    visit(node);
    return parts.join('').trim();
}

function uniqueElements(elements) {
    var seen = new Set();
    var result = [];
    elements.forEach(function(element) {
        if (!seen.has(element.order)) {
            seen.add(element.order);
            result.push(element);
        }
    });
    return result;
}

function findElementsInContext(context, segment) {
    var candidates = segment.axis === 'child'
        ? getElementChildren(context)
        : getDescendantElements(context);
    var tagged = candidates.filter(function(element) {
        return segment.tag === '*' || element.tag === segment.tag;
    });
    return tagged.filter(function(element, index) {
        return matchesXPathPredicates(element, segment.predicates, index + 1);
    });
}

function parseCssSelector(selector) {
    var text = selector.trim();
    if (!text) return null;

    var tagMatch = text.match(/^(\*|[a-zA-Z][\w:-]*)/);
    var tag = tagMatch ? tagMatch[1].toLowerCase() : '*';
    var idMatch = text.match(/#([\w:-]+)/);
    var classes = [];
    var classRegex = /\.([\w:-]+)/g;
    var classMatch;
    while ((classMatch = classRegex.exec(text)) !== null) {
        classes.push(classMatch[1]);
    }

    var attrs = [];
    var attrRegex = /\[([^\]=~|^$*\s]+)(?:\s*([*^$|~]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]"'\s]+)))?\]/g;
    var attrMatch;
    while ((attrMatch = attrRegex.exec(text)) !== null) {
        attrs.push({
            name: attrMatch[1].toLowerCase(),
            operator: attrMatch[2] || 'exists',
            value: attrMatch[3] || attrMatch[4] || attrMatch[5] || ''
        });
    }

    return { tag: tag, id: idMatch ? idMatch[1] : null, classes: classes, attrs: attrs };
}

function matchesCssCriteria(element, criteria) {
    if (criteria.tag !== '*' && element.tag !== criteria.tag) return false;
    if (criteria.id && element.attrs.id !== criteria.id) return false;

    if (criteria.classes.length) {
        var classList = String(element.attrs.class || '').split(/\s+/);
        for (var i = 0; i < criteria.classes.length; i++) {
            if (classList.indexOf(criteria.classes[i]) === -1) return false;
        }
    }

    for (var j = 0; j < criteria.attrs.length; j++) {
        if (!matchesAttributeSelector(element.attrs, criteria.attrs[j])) return false;
    }

    return true;
}

function matchesAttributeSelector(attrs, selector) {
    if (!Object.prototype.hasOwnProperty.call(attrs, selector.name)) return false;
    if (selector.operator === 'exists') return true;

    var actual = String(attrs[selector.name]);
    var expected = String(selector.value);
    switch (selector.operator) {
        case '=':
            return actual === expected;
        case '*=':
            return actual.indexOf(expected) !== -1;
        case '^=':
            return actual.startsWith(expected);
        case '$=':
            return actual.endsWith(expected);
        case '~=':
            return actual.split(/\s+/).indexOf(expected) !== -1;
        case '|=':
            return actual === expected || actual.startsWith(expected + '-');
        default:
            return false;
    }
}

function parseXPath(xpath) {
    var output = null;
    var expression = xpath;
    var outputMatch = expression.match(/\/(text\(\)|@[\w:-]+)$/);
    if (outputMatch) {
        output = outputMatch[1] === 'text()'
            ? 'text'
            : { type: 'attr', name: outputMatch[1].substring(1).toLowerCase() };
        expression = expression.slice(0, -outputMatch[0].length);
    }

    var segments = [];
    var index = 0;

    while (index < expression.length) {
        var axis = null;
        if (expression.slice(index, index + 2) === '//') {
            axis = 'descendant';
            index += 2;
        } else if (expression[index] === '/') {
            axis = 'child';
            index += 1;
        } else {
            return null;
        }

        var segmentStart = index;
        var quote = null;
        var bracketDepth = 0;
        while (index < expression.length) {
            var char = expression[index];

            if (quote) {
                if (char === quote && expression[index - 1] !== '\\') {
                    quote = null;
                }
                index += 1;
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                index += 1;
                continue;
            }

            if (char === '[') {
                bracketDepth += 1;
                index += 1;
                continue;
            }

            if (char === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                index += 1;
                continue;
            }

            if (char === '/' && bracketDepth === 0) {
                break;
            }

            index += 1;
        }

        var segmentText = expression.slice(segmentStart, index).trim();
        if (!segmentText) return null;

        var segment = parseXPathSegment(segmentText);
        if (!segment) return null;
        segment.axis = axis;
        segments.push(segment);
    }

    return segments.length ? { segments: segments, output: output } : null;
}

function parseXPathSegment(segment) {
    var tagMatch = segment.match(/^(\*|[\w:-]+)/);
    if (!tagMatch) return null;
    var predicates = [];
    var predicateRegex = /\[([^\]]+)\]/g;
    var predicateMatch;
    while ((predicateMatch = predicateRegex.exec(segment)) !== null) {
        predicates.push(predicateMatch[1].trim());
    }
    return { tag: tagMatch[1].toLowerCase(), predicates: predicates, axis: 'descendant' };
}

function selectXPathElements(html, segments) {
    var contexts = [parseHtmlTree(html)];
    segments.forEach(function(segment) {
        var next = [];
        contexts.forEach(function(context) {
            next.push.apply(next, findElementsInContext(context, segment));
        });
        contexts = uniqueElements(next);
    });
    return contexts;
}

function findElementsByTag(html, tag) {
    return getDescendantElements(parseHtmlTree(html)).filter(function(element) {
        return tag === '*' || element.tag === tag;
    });
}

function matchesXPathPredicates(element, predicates, position) {
    for (var i = 0; i < predicates.length; i++) {
        if (!matchesXPathPredicate(element, predicates[i], position)) return false;
    }
    return true;
}

function matchesXPathPredicate(element, predicate, position) {
    if (/^\d+$/.test(predicate)) {
        return position === Number(predicate);
    }

    var attrExists = predicate.match(/^@([\w:-]+)$/);
    if (attrExists) {
        return Object.prototype.hasOwnProperty.call(element.attrs, attrExists[1].toLowerCase());
    }

    var attrEquals = predicate.match(/^@([\w:-]+)\s*=\s*["']([^"']+)["']$/);
    if (attrEquals) {
        return String(element.attrs[attrEquals[1].toLowerCase()] || '') === attrEquals[2];
    }

    var attrContains = predicate.match(/^contains\(@([\w:-]+),\s*["']([^"']+)["']\)$/);
    if (attrContains) {
        return String(element.attrs[attrContains[1].toLowerCase()] || '').indexOf(attrContains[2]) !== -1;
    }

    var text = getElementText(element);
    var textEquals = predicate.match(/^text\(\)\s*=\s*["']([^"']+)["']$/);
    if (textEquals) {
        return text === textEquals[1];
    }

    var textContains = predicate.match(/^contains\(text\(\),\s*["']([^"']+)["']\)$/);
    if (textContains) {
        return text.indexOf(textContains[1]) !== -1;
    }

    var normalizeEquals = predicate.match(/^normalize-space\(\)\s*=\s*["']([^"']+)["']$/);
    if (normalizeEquals) {
        return text.replace(/\s+/g, ' ').trim() === normalizeEquals[1];
    }

    return false;
}

function buildElement(tag, rawAttributes, content, outerHtml) {
    return {
        type: 'element',
        tag: String(tag || '').toLowerCase(),
        attrs: parseAttributes(rawAttributes || ''),
        children: [{ type: 'text', text: stripTags(content || '') }],
        content: content || '',
        outerHtml: outerHtml || '',
        order: 0
    };
}

function parseAttributes(rawAttributes) {
    var attrs = {};
    var attrRegex = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    var match;
    while ((match = attrRegex.exec(rawAttributes)) !== null) {
        attrs[String(match[1]).toLowerCase()] = match[2] !== undefined
            ? match[2]
            : match[3] !== undefined
                ? match[3]
                : match[4] !== undefined
                    ? match[4]
                    : '';
    }
    return attrs;
}

function uniqueValues(values) {
    var seen = new Set();
    var result = [];
    values.forEach(function(value) {
        if (!seen.has(value)) {
            seen.add(value);
            result.push(value);
        }
    });
    return result;
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
