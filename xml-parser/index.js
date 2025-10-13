/**
 * @maitask/xml-parser
 * XML to JSON parser with XPath support
 *
 * Features:
 * - XML to JSON conversion
 * - Basic XPath queries
 * - Attribute handling
 * - Namespace support
 * - CDATA handling
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input XML string
 * @param {Object} options - Parser options
 * @param {Object} context - Execution context
 * @returns {Object} Parsed XML data
 */
function execute(input, options = {}, context = {}) {
    try {
        const xml = ensureXml(input);
        const operation = options.operation || 'parse';

        let result;
        const parsed = parseXml(xml);

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

execute;

/**
 * Ensure input is XML string
 */
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

/**
 * Parse XML to JSON
 */
function parseXml(xml) {
    xml = xml.replace(/<!--[\s\S]*?-->/g, '');
    xml = xml.replace(/<\?xml[^?]*\?>/g, '');

    const tokens = tokenizeXml(xml);
    const result = buildTree(tokens, 0);

    return result.node;
}

/**
 * Tokenize XML string
 */
function tokenizeXml(xml) {
    const tokens = [];
    let i = 0;

    while (i < xml.length) {
        if (xml[i] === '<') {
            const closeIndex = xml.indexOf('>', i);

            if (closeIndex === -1) {
                throw new Error('Unclosed tag');
            }

            const tag = xml.slice(i + 1, closeIndex);

            if (tag.startsWith('/')) {
                tokens.push({
                    type: 'close',
                    name: tag.slice(1).trim()
                });
            } else if (tag.endsWith('/')) {
                const { name, attributes } = parseTag(tag.slice(0, -1));
                tokens.push({
                    type: 'self-closing',
                    name,
                    attributes
                });
            } else if (tag.startsWith('![CDATA[')) {
                const cdataEnd = xml.indexOf(']]>', i);
                const content = xml.slice(i + 9, cdataEnd);
                tokens.push({
                    type: 'cdata',
                    content
                });
                i = cdataEnd + 3;
                continue;
            } else {
                const { name, attributes } = parseTag(tag);
                tokens.push({
                    type: 'open',
                    name,
                    attributes
                });
            }

            i = closeIndex + 1;
        } else {
            const nextTag = xml.indexOf('<', i);
            const text = xml.slice(i, nextTag === -1 ? undefined : nextTag).trim();

            if (text) {
                tokens.push({
                    type: 'text',
                    content: text
                });
            }

            i = nextTag === -1 ? xml.length : nextTag;
        }
    }

    return tokens;
}

/**
 * Parse tag name and attributes
 */
function parseTag(tag) {
    const spaceIndex = tag.search(/\s/);

    if (spaceIndex === -1) {
        return { name: tag.trim(), attributes: {} };
    }

    const name = tag.slice(0, spaceIndex).trim();
    const attrString = tag.slice(spaceIndex).trim();
    const attributes = parseAttributes(attrString);

    return { name, attributes };
}

/**
 * Parse XML attributes
 */
function parseAttributes(attrString) {
    const attributes = {};
    const regex = /(\w+(?::\w+)?)=["']([^"']+)["']/g;
    let match;

    while ((match = regex.exec(attrString)) !== null) {
        attributes[match[1]] = match[2];
    }

    return attributes;
}

/**
 * Build tree from tokens
 */
function buildTree(tokens, start) {
    let i = start;

    if (i >= tokens.length) {
        return { node: null, nextIndex: i };
    }

    const token = tokens[i];

    if (token.type === 'open') {
        const node = {
            _tag: token.name,
            _attributes: token.attributes,
            _children: []
        };

        i++;

        while (i < tokens.length) {
            const current = tokens[i];

            if (current.type === 'close' && current.name === token.name) {
                i++;
                break;
            }

            if (current.type === 'text') {
                node._text = current.content;
                i++;
            } else if (current.type === 'cdata') {
                node._text = current.content;
                i++;
            } else {
                const child = buildTree(tokens, i);
                node._children.push(child.node);
                i = child.nextIndex;
            }
        }

        return { node, nextIndex: i };
    }

    if (token.type === 'self-closing') {
        return {
            node: {
                _tag: token.name,
                _attributes: token.attributes,
                _children: []
            },
            nextIndex: i + 1
        };
    }

    return { node: null, nextIndex: i + 1 };
}

/**
 * Query XML tree using basic XPath
 */
function queryXPath(tree, xpath) {
    if (!xpath || xpath === '/') {
        return tree;
    }

    const parts = xpath.split('/').filter(p => p);
    return traversePath(tree, parts, 0);
}

/**
 * Traverse tree following path
 */
function traversePath(node, parts, index) {
    if (index >= parts.length) {
        return node;
    }

    const part = parts[index];

    if (part === '*') {
        return node._children || [];
    }

    if (part === '**') {
        return findAllDescendants(node);
    }

    const matches = [];

    if (node._tag === part) {
        const result = traversePath(node, parts, index + 1);
        if (result) return result;
    }

    if (node._children) {
        for (const child of node._children) {
            if (child._tag === part) {
                const result = traversePath(child, parts, index + 1);
                if (result) matches.push(result);
            }
        }
    }

    return matches.length === 1 ? matches[0] : matches;
}

/**
 * Find all descendants matching tag
 */
function findAllDescendants(node) {
    const result = [];

    function traverse(n) {
        result.push(n);
        if (n._children) {
            for (const child of n._children) {
                traverse(child);
            }
        }
    }

    traverse(node);
    return result;
}
