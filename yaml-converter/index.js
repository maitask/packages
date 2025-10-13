/**
 * @maitask/yaml-converter
 * YAML to JSON bidirectional converter
 *
 * Features:
 * - YAML to JSON conversion
 * - JSON to YAML conversion
 * - Basic YAML parsing (scalars, sequences, mappings)
 * - Indentation control
 * - Type preservation
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input YAML or JSON data
 * @param {Object} options - Conversion options
 * @param {Object} context - Execution context
 * @returns {Object} Conversion results
 */
function execute(input, options = {}, context = {}) {
    try {
        const direction = options.direction || 'auto';
        const indent = options.indent || 2;

        let result;
        let detectedDirection;

        if (direction === 'auto') {
            detectedDirection = detectDirection(input);
        } else {
            detectedDirection = direction;
        }

        if (detectedDirection === 'yaml-to-json') {
            const yaml = ensureYaml(input);
            result = yamlToJson(yaml);
        } else if (detectedDirection === 'json-to-yaml') {
            const json = ensureJson(input);
            result = jsonToYaml(json, indent);
        } else {
            throw new Error(`Unknown direction: ${detectedDirection}`);
        }

        return {
            success: true,
            direction: detectedDirection,
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
                message: error.message || 'Conversion error',
                code: 'CONVERT_ERROR',
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
 * Detect conversion direction
 */
function detectDirection(input) {
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            return 'json-to-yaml';
        }
        return 'yaml-to-json';
    }

    if (typeof input === 'object' && input !== null) {
        if (input.text && typeof input.text === 'string') {
            return detectDirection(input.text);
        }
        return 'json-to-yaml';
    }

    return 'yaml-to-json';
}

/**
 * Ensure input is YAML string
 */
function ensureYaml(input) {
    if (typeof input === 'string') {
        return input;
    }

    if (input && typeof input.text === 'string') {
        return input.text;
    }

    if (input && typeof input.yaml === 'string') {
        return input.yaml;
    }

    throw new Error('Invalid input: YAML string expected');
}

/**
 * Ensure input is JSON data
 */
function ensureJson(input) {
    if (typeof input === 'string') {
        return JSON.parse(input);
    }

    if (input && input.data !== undefined) {
        return input.data;
    }

    if (input && input.json !== undefined) {
        return input.json;
    }

    return input;
}

/**
 * Convert YAML to JSON
 */
function yamlToJson(yaml) {
    const lines = yaml.split('\n');
    const result = parseYamlLines(lines, 0, -1);
    return result.value;
}

/**
 * Parse YAML lines recursively
 */
function parseYamlLines(lines, start, parentIndent) {
    let i = start;
    let current = null;
    let currentKey = null;
    let isArray = false;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            i++;
            continue;
        }

        const indent = line.search(/\S/);

        if (indent <= parentIndent && parentIndent >= 0) {
            break;
        }

        if (trimmed.startsWith('- ')) {
            if (!current) {
                current = [];
                isArray = true;
            }

            const value = trimmed.slice(2);
            const parsed = parseValue(value);

            if (parsed.type === 'object' || value.endsWith(':')) {
                const nested = parseYamlLines(lines, i + 1, indent);
                current.push(nested.value);
                i = nested.nextLine;
            } else {
                current.push(parsed.value);
                i++;
            }
        } else if (trimmed.includes(':')) {
            if (!current) {
                current = {};
            }

            const colonIndex = trimmed.indexOf(':');
            const key = trimmed.slice(0, colonIndex).trim();
            const value = trimmed.slice(colonIndex + 1).trim();

            if (!value || value === '') {
                const nested = parseYamlLines(lines, i + 1, indent);
                current[key] = nested.value;
                i = nested.nextLine;
            } else {
                const parsed = parseValue(value);
                current[key] = parsed.value;
                i++;
            }
        } else {
            i++;
        }
    }

    return { value: current, nextLine: i };
}

/**
 * Parse YAML value
 */
function parseValue(value) {
    const trimmed = value.trim();

    if (trimmed === 'null' || trimmed === '~') {
        return { type: 'null', value: null };
    }

    if (trimmed === 'true') {
        return { type: 'boolean', value: true };
    }

    if (trimmed === 'false') {
        return { type: 'boolean', value: false };
    }

    if (/^-?\d+$/.test(trimmed)) {
        return { type: 'number', value: parseInt(trimmed) };
    }

    if (/^-?\d*\.\d+$/.test(trimmed)) {
        return { type: 'number', value: parseFloat(trimmed) };
    }

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return { type: 'string', value: trimmed.slice(1, -1) };
    }

    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return { type: 'string', value: trimmed.slice(1, -1) };
    }

    if (trimmed === '') {
        return { type: 'object', value: {} };
    }

    return { type: 'string', value: trimmed };
}

/**
 * Convert JSON to YAML
 */
function jsonToYaml(data, indent = 2) {
    return serializeYaml(data, 0, indent);
}

/**
 * Serialize data to YAML format
 */
function serializeYaml(data, level, indent) {
    const space = ' '.repeat(level * indent);

    if (data === null || data === undefined) {
        return 'null';
    }

    if (typeof data === 'boolean') {
        return String(data);
    }

    if (typeof data === 'number') {
        return String(data);
    }

    if (typeof data === 'string') {
        if (needsQuoting(data)) {
            return `"${escapeString(data)}"`;
        }
        return data;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) {
            return '[]';
        }

        const items = data.map(item => {
            const value = serializeYaml(item, level + 1, indent);
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                const lines = value.split('\n');
                const first = lines[0];
                const rest = lines.slice(1).join('\n');
                return `${space}- ${first}\n${rest}`;
            }
            return `${space}- ${value}`;
        });

        return items.join('\n');
    }

    if (typeof data === 'object') {
        const keys = Object.keys(data);

        if (keys.length === 0) {
            return '{}';
        }

        const pairs = keys.map(key => {
            const value = data[key];
            const serialized = serializeYaml(value, level + 1, indent);

            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value) && value.length > 0) {
                    return `${space}${key}:\n${serialized}`;
                } else if (!Array.isArray(value) && Object.keys(value).length > 0) {
                    return `${space}${key}:\n${serialized}`;
                }
            }

            return `${space}${key}: ${serialized}`;
        });

        return pairs.join('\n');
    }

    return String(data);
}

/**
 * Check if string needs quoting
 */
function needsQuoting(str) {
    if (/^(true|false|null|~)$/i.test(str)) {
        return true;
    }

    if (/^-?\d+(\.\d+)?$/.test(str)) {
        return true;
    }

    if (/[:#\[\]{}|>*&!%@`]/.test(str)) {
        return true;
    }

    if (str.startsWith(' ') || str.endsWith(' ')) {
        return true;
    }

    return false;
}

/**
 * Escape string for YAML
 */
function escapeString(str) {
    return str.replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
}
