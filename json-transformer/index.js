/**
 * @maitask/json-transformer
 * JSONPath query and data transformation
 *
 * Features:
 * - JSONPath query support
 * - Data mapping and transformation
 * - Property extraction and filtering
 * - Array operations
 * - Deep object manipulation
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input JSON data
 * @param {Object} options - Transformation options
 * @param {Object} context - Execution context
 * @returns {Object} Transformed data
 */
function execute(input, options = {}, context = {}) {
    try {
        const data = ensureJsonData(input);
        const operation = options.operation || 'query';

        let result;
        switch (operation) {
            case 'query':
                result = queryJson(data, options.path || '$');
                break;
            case 'map':
                result = mapData(data, options.mapping || {});
                break;
            case 'filter':
                result = filterData(data, options.condition || {});
                break;
            case 'extract':
                result = extractFields(data, options.fields || []);
                break;
            case 'flatten':
                result = flattenData(data, options.separator || '.');
                break;
            case 'unflatten':
                result = unflattenData(data, options.separator || '.');
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }

        return {
            success: true,
            operation,
            data: result,
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Transformation error',
                code: 'TRANSFORM_ERROR',
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
 * Ensure input is valid JSON data
 */
function ensureJsonData(input) {
    if (!input) {
        throw new Error('Input is required');
    }

    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch (e) {
            throw new Error('Invalid JSON string');
        }
    }

    if (input.data !== undefined) {
        return input.data;
    }

    return input;
}

/**
 * Query JSON using JSONPath-like syntax
 * Supports: $, $.prop, $.arr[0], $.*.prop, $..prop
 */
function queryJson(data, path) {
    if (path === '$') {
        return data;
    }

    const tokens = parseJsonPath(path);
    return evaluatePath(data, tokens);
}

/**
 * Parse JSONPath into tokens
 */
function parseJsonPath(path) {
    if (!path.startsWith('$')) {
        throw new Error('JSONPath must start with $');
    }

    const tokens = [];
    let current = '';
    let inBracket = false;

    for (let i = 1; i < path.length; i++) {
        const char = path[i];

        if (char === '[') {
            if (current) {
                tokens.push({ type: 'property', value: current });
                current = '';
            }
            inBracket = true;
        } else if (char === ']') {
            if (inBracket && current) {
                const num = parseInt(current);
                if (!isNaN(num)) {
                    tokens.push({ type: 'index', value: num });
                } else {
                    tokens.push({ type: 'property', value: current.replace(/['"]/g, '') });
                }
                current = '';
            }
            inBracket = false;
        } else if (char === '.' && !inBracket) {
            if (current) {
                if (current === '*') {
                    tokens.push({ type: 'wildcard' });
                } else if (current === '') {
                    tokens.push({ type: 'recursive' });
                } else {
                    tokens.push({ type: 'property', value: current });
                }
                current = '';
            } else if (path[i + 1] === '.') {
                tokens.push({ type: 'recursive' });
                i++;
            }
        } else {
            current += char;
        }
    }

    if (current) {
        if (current === '*') {
            tokens.push({ type: 'wildcard' });
        } else {
            tokens.push({ type: 'property', value: current });
        }
    }

    return tokens;
}

/**
 * Evaluate JSONPath tokens
 */
function evaluatePath(data, tokens) {
    let current = [data];

    for (const token of tokens) {
        const next = [];

        for (const item of current) {
            if (item === null || item === undefined) {
                continue;
            }

            switch (token.type) {
                case 'property':
                    if (typeof item === 'object' && !Array.isArray(item)) {
                        if (item[token.value] !== undefined) {
                            next.push(item[token.value]);
                        }
                    }
                    break;

                case 'index':
                    if (Array.isArray(item)) {
                        const index = token.value < 0 ? item.length + token.value : token.value;
                        if (item[index] !== undefined) {
                            next.push(item[index]);
                        }
                    }
                    break;

                case 'wildcard':
                    if (Array.isArray(item)) {
                        next.push(...item);
                    } else if (typeof item === 'object') {
                        next.push(...Object.values(item));
                    }
                    break;

                case 'recursive':
                    collectRecursive(item, next);
                    break;
            }
        }

        current = next;
    }

    return current.length === 1 ? current[0] : current;
}

/**
 * Collect all values recursively
 */
function collectRecursive(obj, result) {
    if (obj === null || typeof obj !== 'object') {
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            result.push(item);
            collectRecursive(item, result);
        }
    } else {
        for (const value of Object.values(obj)) {
            result.push(value);
            collectRecursive(value, result);
        }
    }
}

/**
 * Map data using transformation rules
 * mapping: { newKey: 'path.to.value', ... }
 */
function mapData(data, mapping) {
    const result = {};

    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
        if (typeof sourcePath === 'string') {
            const value = getNestedValue(data, sourcePath);
            if (value !== undefined) {
                result[targetKey] = value;
            }
        } else if (typeof sourcePath === 'function') {
            result[targetKey] = sourcePath(data);
        } else {
            result[targetKey] = sourcePath;
        }
    }

    return result;
}

/**
 * Get nested value using dot notation
 */
function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }

        const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            current = current[arrayMatch[1]];
            if (Array.isArray(current)) {
                current = current[parseInt(arrayMatch[2])];
            } else {
                return undefined;
            }
        } else {
            current = current[part];
        }
    }

    return current;
}

/**
 * Filter data based on conditions
 * condition: { field: value } or { field: { $gt: value } }
 */
function filterData(data, condition) {
    if (!Array.isArray(data)) {
        data = [data];
    }

    return data.filter(item => matchesCondition(item, condition));
}

/**
 * Check if item matches condition
 */
function matchesCondition(item, condition) {
    for (const [key, value] of Object.entries(condition)) {
        const itemValue = getNestedValue(item, key);

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [op, opValue] of Object.entries(value)) {
                if (!evaluateOperator(itemValue, op, opValue)) {
                    return false;
                }
            }
        } else {
            if (itemValue !== value) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Evaluate comparison operator
 */
function evaluateOperator(value, operator, target) {
    switch (operator) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        case '$exists': return (value !== undefined) === target;
        case '$regex': return new RegExp(target).test(String(value));
        default: return false;
    }
}

/**
 * Extract specific fields from data
 */
function extractFields(data, fields) {
    if (Array.isArray(data)) {
        return data.map(item => extractFromObject(item, fields));
    }

    return extractFromObject(data, fields);
}

/**
 * Extract fields from a single object
 */
function extractFromObject(obj, fields) {
    const result = {};

    for (const field of fields) {
        const value = getNestedValue(obj, field);
        if (value !== undefined) {
            setNestedValue(result, field, value);
        }
    }

    return result;
}

/**
 * Set nested value using dot notation
 */
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current)) {
            current[part] = {};
        }
        current = current[part];
    }

    current[parts[parts.length - 1]] = value;
}

/**
 * Flatten nested object
 */
function flattenData(data, separator = '.') {
    const result = {};

    function flatten(obj, prefix = '') {
        for (const [key, value] of Object.entries(obj)) {
            const newKey = prefix ? `${prefix}${separator}${key}` : key;

            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                flatten(value, newKey);
            } else {
                result[newKey] = value;
            }
        }
    }

    flatten(data);
    return result;
}

/**
 * Unflatten object
 */
function unflattenData(data, separator = '.') {
    const result = {};

    for (const [key, value] of Object.entries(data)) {
        setNestedValue(result, key.replace(new RegExp(separator.replace('.', '\\.'), 'g'), '.'), value);
    }

    return result;
}
