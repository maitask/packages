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
 * @version 0.1.1
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
        const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const data = ensureJsonData(input);
        const operation = opts.operation || 'query';

        let result;
        switch (operation) {
            case 'query':
                result = queryJson(data, opts.path || '$');
                break;
            case 'map':
                result = mapData(data, opts.mapping || {});
                break;
            case 'filter':
                result = filterData(data, opts.condition || {});
                break;
            case 'extract':
                result = extractFields(data, opts.fields || []);
                break;
            case 'flatten':
                result = flattenData(data, opts.separator || '.');
                break;
            case 'unflatten':
                result = unflattenData(data, opts.separator || '.');
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
                version: '0.1.1'
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
                version: '0.1.1'
            }
        };
    }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
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
                        if (isSafePathKey(token.value) && Object.hasOwn(item, token.value) && item[token.value] !== undefined) {
                            next.push(item[token.value]);
                        }
                    }
                    break;

                case 'index':
                    if (Array.isArray(item)) {
                        const index = token.value < 0 ? item.length + token.value : token.value;
                        if (index >= 0 && index < item.length && item[index] !== undefined) {
                            next.push(item[index]);
                        }
                    }
                    break;

                case 'wildcard':
                    if (Array.isArray(item)) {
                        next.push(...item);
                    } else if (typeof item === 'object') {
                        for (const key of Object.keys(item)) {
                            if (Object.hasOwn(item, key) && isSafePathKey(key)) {
                                next.push(item[key]);
                            }
                        }
                    }
                    break;

                case 'recursive':
                    collectRecursive(item, next, new WeakSet());
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
function collectRecursive(obj, result, seen = new WeakSet()) {
    if (obj === null || typeof obj !== 'object') {
        return;
    }
    if (seen.has(obj)) {
        return;
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
        for (const item of obj) {
            result.push(item);
            collectRecursive(item, result, seen);
        }
    } else {
        for (const key of Object.keys(obj)) {
            if (!Object.hasOwn(obj, key) || !isSafePathKey(key)) continue;
            const value = obj[key];
            result.push(value);
            collectRecursive(value, result, seen);
        }
    }
}

/**
 * Map data using transformation rules
 * mapping: { newKey: 'path.to.value', ... }
 */
function mapData(data, mapping) {
    const result = Object.create(null);
    if (!mapping || typeof mapping !== 'object') {
        return result;
    }

    for (const targetKey of Object.keys(mapping)) {
        if (!Object.hasOwn(mapping, targetKey) || !isSafePathKey(targetKey)) continue;
        const sourcePath = mapping[targetKey];
        if (typeof sourcePath === 'string') {
            const value = getNestedValue(data, sourcePath);
            if (value !== undefined) {
                result[targetKey] = value;
            }
        } else if (typeof sourcePath !== 'function') {
            result[targetKey] = sourcePath;
        }
    }

    return result;
}

/**
 * Get nested value using dot notation
 */
function getNestedValue(obj, path) {
    const parts = String(path || '').split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }

        const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            const prop = arrayMatch[1];
            if (!isSafePathKey(prop) || typeof current !== 'object' || !Object.hasOwn(current, prop)) {
                return undefined;
            }
            current = current[prop];
            if (Array.isArray(current)) {
                current = current[parseInt(arrayMatch[2], 10)];
            } else {
                return undefined;
            }
        } else {
            if (!isSafePathKey(part) || typeof current !== 'object' || !Object.hasOwn(current, part)) {
                return undefined;
            }
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
    if (!condition || typeof condition !== 'object') return true;
    for (const key of Object.keys(condition)) {
        if (!Object.hasOwn(condition, key) || !isSafePathKey(key)) continue;
        const value = condition[key];
        const itemValue = getNestedValue(item, key);

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const op of Object.keys(value)) {
                if (!Object.hasOwn(value, op)) continue;
                if (!evaluateOperator(itemValue, op, value[op])) {
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
        case '$regex': {
            const pattern = target instanceof RegExp ? target.source : String(target ?? '');
            if (!pattern || pattern.length > 512) return false;
            try {
                const regex = target instanceof RegExp ? target : new RegExp(pattern);
                return regex.test(String(value ?? ''));
            } catch {
                return false;
            }
        }
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
    const result = Object.create(null);

    for (const field of Array.isArray(fields) ? fields : []) {
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
function isSafePathKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!isSafePathKey(part)) {
            throw new Error(`Unsafe property key: ${part}`);
        }
        if (!Object.hasOwn(current, part) || typeof current[part] !== 'object' || current[part] === null) {
            Object.defineProperty(current, part, { value: {}, enumerable: true, writable: true, configurable: true });
        }
        current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    if (!isSafePathKey(lastPart)) {
        throw new Error(`Unsafe property key: ${lastPart}`);
    }
    Object.defineProperty(current, lastPart, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Flatten nested object
 */
function flattenData(data, separator = '.') {
    const result = Object.create(null);
    const seen = new WeakSet();

    function flatten(obj, prefix = '') {
        if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
        seen.add(obj);
        for (const key of Object.keys(obj)) {
            if (!Object.hasOwn(obj, key) || !isSafePathKey(key)) continue;
            const value = obj[key];
            const newKey = prefix ? `${prefix}${separator}${key}` : key;
            if (!isSafePathKey(newKey)) continue;

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
    const result = Object.create(null);
    if (!data || typeof data !== 'object') return result;
    const sepText = String(separator || '.');
    const escapedSep = sepText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sepRegex = new RegExp(escapedSep, 'g');

    for (const key of Object.keys(data)) {
        if (!Object.hasOwn(data, key) || !isSafePathKey(key)) continue;
        setNestedValue(result, key.replace(sepRegex, '.'), data[key]);
    }

    return result;
}
