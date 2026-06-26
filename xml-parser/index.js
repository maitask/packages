/**
 * @maitask/xml-parser
 * XML to JSON parser with XPath support.
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

function execute(input, options = {}, context = {}) {
    try {
        const xml = ensureXml(input);
        const operation = options.operation || 'parse';
        const parsed = parseXml(xml, options);
        let result;

        switch (operation) {
            case 'parse':
                result = parsed;
                break;
            case 'query':
                if (!options.xpath) {
                    throw new Error('XPath query is required for query operation');
                }
                result = queryXPath(parsed, options.xpath);
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }

        return {
            success: true,
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
                message: error.message || 'XML parsing error',
                code: 'XML_ERROR',
                type: error.constructor.name
            },
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

function ensureXml(input) {
    if (typeof input === 'string') {
        return input.trim();
    }

    if (input && typeof input.text === 'string') {
        return input.text.trim();
    }

    if (input && typeof input.xml === 'string') {
        return input.xml.trim();
    }

    throw new Error('Invalid input: XML string expected');
}

function parseXml(xml, options = {}) {
    const preserveWhitespace = options.preserveWhitespace === true;
    const source = String(xml || '');
    const documentNode = createXmlNode('#document', {});
    const stack = [documentNode];
    let index = 0;

    while (index < source.length) {
        if (source[index] !== '<') {
            const next = source.indexOf('<', index);
            appendText(stack[stack.length - 1], source.slice(index, next === -1 ? source.length : next), preserveWhitespace);
            index = next === -1 ? source.length : next;
            continue;
        }

        if (source.startsWith('<!--', index)) {
            const end = source.indexOf('-->', index + 4);
            if (end === -1) throw new Error('Unclosed XML comment');
            index = end + 3;
            continue;
        }

        if (source.startsWith('<![CDATA[', index)) {
            const end = source.indexOf(']]>', index + 9);
            if (end === -1) throw new Error('Unclosed XML CDATA section');
            appendText(stack[stack.length - 1], source.slice(index + 9, end), true);
            index = end + 3;
            continue;
        }

        if (source.startsWith('<?', index)) {
            const end = source.indexOf('?>', index + 2);
            if (end === -1) throw new Error('Unclosed XML processing instruction');
            index = end + 2;
            continue;
        }

        if (source.startsWith('<!', index)) {
            const end = findDeclarationEnd(source, index + 2);
            if (end === -1) throw new Error('Unclosed XML declaration');
            index = end + 1;
            continue;
        }

        const close = findTagEnd(source, index + 1);
        if (close === -1) throw new Error('Unclosed XML tag');

        const raw = source.slice(index + 1, close).trim();
        if (raw.startsWith('/')) {
            const closingName = raw.slice(1).trim();
            const current = stack.pop();
            if (!current || current._tag !== closingName) {
                throw new Error(`Mismatched XML closing tag: ${closingName}`);
            }
            index = close + 1;
            continue;
        }

        const selfClosing = /\/\s*$/.test(raw);
        const tagSource = selfClosing ? raw.replace(/\/\s*$/, '') : raw;
        const parsedTag = parseTag(tagSource);
        const node = createXmlNode(parsedTag.name, parsedTag.attributes);
        stack[stack.length - 1]._children.push(node);

        if (!selfClosing) {
            stack.push(node);
        }

        index = close + 1;
    }

    if (stack.length !== 1) {
        throw new Error(`Unclosed XML tag: ${stack[stack.length - 1]._tag}`);
    }

    return documentNode._children.length === 1 ? documentNode._children[0] : documentNode;
}

function createXmlNode(tag, attributes) {
    return {
        _tag: tag,
        _attributes: attributes || {},
        _children: []
    };
}

function appendText(node, text, preserveWhitespace) {
    if (!text) return;
    const value = preserveWhitespace ? text : text.replace(/\s+/g, ' ').trim();
    if (!value) return;
    node._text = (node._text || '') + decodeXml(value);
}

function findTagEnd(source, start) {
    let quote = null;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (quote) {
            if (char === quote && source[i - 1] !== '\\') quote = null;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '>') return i;
    }
    return -1;
}

function findDeclarationEnd(source, start) {
    let bracketDepth = 0;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '[') bracketDepth++;
        if (source[i] === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        if (source[i] === '>' && bracketDepth === 0) return i;
    }
    return -1;
}

function parseTag(tagSource) {
    const nameMatch = tagSource.match(/^([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) throw new Error(`Invalid XML tag: ${tagSource}`);

    return {
        name: nameMatch[1],
        attributes: parseAttributes(tagSource.slice(nameMatch[1].length))
    };
}

function parseAttributes(attrSource) {
    const attributes = {};
    const regex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match;

    while ((match = regex.exec(attrSource)) !== null) {
        attributes[match[1]] = decodeXml(match[3] !== undefined ? match[3] : match[4]);
    }

    return attributes;
}

function queryXPath(tree, xpath) {
    if (!xpath || xpath === '/') {
        return tree;
    }

    const parsed = parseXPath(xpath);
    const nodes = selectXPathNodes(tree, parsed.segments);
    const values = parsed.output ? nodes.map(node => extractXPathOutput(node, parsed.output)).filter(value => value !== null) : nodes;

    return values.length === 1 ? values[0] : values;
}

function parseXPath(xpath) {
    let expression = String(xpath || '').trim();
    let output = null;
    const outputMatch = expression.match(/\/(text\(\)|@[\w:.-]+)$/);

    if (outputMatch) {
        output = outputMatch[1] === 'text()'
            ? { type: 'text' }
            : { type: 'attribute', name: outputMatch[1].slice(1) };
        expression = expression.slice(0, -outputMatch[0].length);
    }

    const segments = [];
    let index = 0;

    while (index < expression.length) {
        let axis = null;
        if (expression.slice(index, index + 2) === '//') {
            axis = 'descendant';
            index += 2;
        } else if (expression[index] === '/') {
            axis = segments.length === 0 ? 'self-or-child' : 'child';
            index += 1;
        } else if (segments.length === 0) {
            axis = 'self-or-child';
        } else {
            return invalidXPath(expression);
        }

        const start = index;
        let quote = null;
        let bracketDepth = 0;
        while (index < expression.length) {
            const char = expression[index];
            if (quote) {
                if (char === quote && expression[index - 1] !== '\\') quote = null;
                index++;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                index++;
                continue;
            }
            if (char === '[') {
                bracketDepth++;
                index++;
                continue;
            }
            if (char === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                index++;
                continue;
            }
            if (char === '/' && bracketDepth === 0) break;
            index++;
        }

        const rawSegment = expression.slice(start, index).trim();
        if (!rawSegment) return invalidXPath(expression);
        segments.push(parseXPathSegment(rawSegment, axis));
    }

    if (!segments.length) return invalidXPath(expression);
    return { segments, output };
}

function parseXPathSegment(segment, axis) {
    const nameMatch = segment.match(/^(\*|[A-Za-z_][\w:.-]*)/);
    if (!nameMatch) throw new Error(`Invalid XPath segment: ${segment}`);

    const predicates = [];
    const regex = /\[([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(segment)) !== null) {
        predicates.push(match[1].trim());
    }

    return { tag: nameMatch[1], axis, predicates };
}

function selectXPathNodes(root, segments) {
    let contexts = [root];

    segments.forEach((segment, segmentIndex) => {
        const next = [];
        contexts.forEach(context => {
            const candidates = getXPathCandidates(context, segment, segmentIndex);
            const tagged = candidates.filter(node => segment.tag === '*' || node._tag === segment.tag);
            tagged.forEach((node, index) => {
                if (matchesPredicates(node, segment.predicates, index + 1)) {
                    next.push(node);
                }
            });
        });
        contexts = uniqueNodes(next);
    });

    return contexts;
}

function getXPathCandidates(context, segment, segmentIndex) {
    if (segment.axis === 'descendant') {
        return getDescendants(context);
    }
    if (segment.axis === 'self-or-child' && segmentIndex === 0) {
        return [context].concat(context._children || []);
    }
    return context._children || [];
}

function matchesPredicates(node, predicates, position) {
    for (const predicate of predicates) {
        if (!matchesPredicate(node, predicate, position)) return false;
    }
    return true;
}

function matchesPredicate(node, predicate, position) {
    if (/^\d+$/.test(predicate)) {
        return position === Number(predicate);
    }

    const attrExists = predicate.match(/^@([\w:.-]+)$/);
    if (attrExists) {
        return Object.prototype.hasOwnProperty.call(node._attributes || {}, attrExists[1]);
    }

    const attrCompare = predicate.match(/^@([\w:.-]+)\s*(=|!=)\s*["']([^"']*)["']$/);
    if (attrCompare) {
        const actual = String((node._attributes || {})[attrCompare[1]] ?? '');
        return attrCompare[2] === '=' ? actual === attrCompare[3] : actual !== attrCompare[3];
    }

    const attrContains = predicate.match(/^contains\(@([\w:.-]+),\s*["']([^"']*)["']\)$/);
    if (attrContains) {
        return String((node._attributes || {})[attrContains[1]] ?? '').includes(attrContains[2]);
    }

    const textCompare = predicate.match(/^text\(\)\s*(=|!=)\s*["']([^"']*)["']$/);
    if (textCompare) {
        const text = getNodeText(node);
        return textCompare[1] === '=' ? text === textCompare[2] : text !== textCompare[2];
    }

    const textContains = predicate.match(/^contains\(text\(\),\s*["']([^"']*)["']\)$/);
    if (textContains) {
        return getNodeText(node).includes(textContains[1]);
    }

    const childCompare = predicate.match(/^([A-Za-z_][\w:.-]*)\s*(=|!=|>=|<=|>|<)\s*["']?([^"']+)["']?$/);
    if (childCompare) {
        const child = (node._children || []).find(item => item._tag === childCompare[1]);
        if (!child) return false;
        return compareValues(getNodeText(child), childCompare[3], childCompare[2]);
    }

    return false;
}

function compareValues(left, right, operator) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const a = numeric ? leftNumber : String(left);
    const b = numeric ? rightNumber : String(right);

    switch (operator) {
        case '=':
            return a === b;
        case '!=':
            return a !== b;
        case '>':
            return a > b;
        case '<':
            return a < b;
        case '>=':
            return a >= b;
        case '<=':
            return a <= b;
        default:
            return false;
    }
}

function extractXPathOutput(node, output) {
    if (output.type === 'text') {
        return getNodeText(node);
    }
    if (output.type === 'attribute') {
        return Object.prototype.hasOwnProperty.call(node._attributes || {}, output.name)
            ? node._attributes[output.name]
            : null;
    }
    return node;
}

function getNodeText(node) {
    const parts = [];
    if (node._text) parts.push(node._text);
    (node._children || []).forEach(child => {
        const text = getNodeText(child);
        if (text) parts.push(text);
    });
    return parts.join('').trim();
}

function getDescendants(node) {
    const result = [];
    function visit(current) {
        (current._children || []).forEach(child => {
            result.push(child);
            visit(child);
        });
    }
    visit(node);
    return result;
}

function uniqueNodes(nodes) {
    const seen = new Set();
    const result = [];
    nodes.forEach(node => {
        if (!seen.has(node)) {
            seen.add(node);
            result.push(node);
        }
    });
    return result;
}

function decodeXml(value) {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function invalidXPath(expression) {
    throw new Error(`Invalid XPath expression: ${expression}`);
}

execute;
