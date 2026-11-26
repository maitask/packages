/**
 * @maitask/data-validator
 * Comprehensive data validation and quality assurance
 *
 * Features:
 * - JSON Schema validation
 * - Custom validation rules
 * - Data type checking
 * - Data quality analysis
 * - Flexible validation modes
 * - Detailed error reporting
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for data validation
 * @param {Object|Array} input - Data to validate
 * @param {Object} options - Validation configuration
 * @param {Object} context - Execution context
 * @returns {Object} Validation results with detailed reporting
 */
async function execute(input = {}, options = {}, context = {}) {
    try {
        const config = buildConfig(input, options, context);
        const data =
            input && Object.hasOwn(input, 'data') && input.data !== undefined
                ? input.data
                : input !== undefined
                    ? input
                    : [];

        if (!Array.isArray(data) && typeof data !== 'object') {
            throw new Error('Input data must be an array or object');
        }

        let schema = config.schema;

        if (config.schema_url && !schema) {
            schema = await fetchSchemaFromUrl(config.schema_url);
        }

        const validationResults = Array.isArray(data)
            ? validateArray(data, schema, config)
            : validateObject(data, schema, config);

        const summary = generateValidationSummary(validationResults);

        const isReportOnly = config.validation_mode === 'report-only';
        if (isReportOnly || summary.valid_count === summary.total_count) {
            return {
                success: true,
                data: {
                    summary: summary,
                    results: validationResults,
                    schema_used: !!schema,
                    validation_mode: config.validation_mode,
                    has_errors: summary.error_count > 0
                },
                metadata: {
                    package: '@maitask/data-validator',
                    validated_at: new Date().toISOString(),
                    validation_mode: config.validation_mode,
                    schema_source: config.schema_url ? 'url' : 'inline',
                    version: '0.1.1'
                }
            };
        }

        return {
            success: false,
            data: {
                summary: summary,
                results: validationResults,
                schema_used: !!schema,
                validation_mode: config.validation_mode
            },
            error: {
                message: `Validation completed with invalid records: ${summary.invalid_count} / ${summary.total_count}`,
                code: 'VALIDATION_RESULT_ERROR',
                type: 'ValidationResultError'
            },
            metadata: {
                package: '@maitask/data-validator',
                validated_at: new Date().toISOString(),
                validation_mode: config.validation_mode,
                schema_source: config.schema_url ? 'url' : 'inline',
                version: '0.1.1'
            }
        };

    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown validation error',
                code: 'VALIDATION_ERROR',
                type: 'ValidationError',
                details: error.details || null
            },
            metadata: {
                package: '@maitask/data-validator',
                validated_at: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    }
}

function buildConfig(input, options, context) {
    const trustedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const rawInputConfig = input && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config : {};
    const safeInputConfig = {};
    for (const key of Object.keys(rawInputConfig)) {
        if (key === 'schema_url' || key === 'schemaUrl' || key === 'validation_mode' || key === 'validationMode' || !isSafeKey(key)) {
            continue;
        }
        safeInputConfig[key] = rawInputConfig[key];
    }
    const source = mergeObjects(safeInputConfig, trustedOptions);

    return {
        schema: source.schema,
        schema_url: trustedOptions.schema_url,
        validation_mode: normalizeValidationMode(trustedOptions.validation_mode),
        required_fields: Array.isArray(source.required_fields) ? source.required_fields : [],
        data_types: source.data_types && typeof source.data_types === 'object' && !Array.isArray(source.data_types) ? source.data_types : {},
        custom_rules: Array.isArray(source.custom_rules) ? source.custom_rules : [],
        stop_on_first_error: Boolean(source.stop_on_first_error)
    };
}

function normalizeValidationMode(value) {
    const mode = String(value || 'strict').toLowerCase();
    if (mode === 'strict' || mode === 'loose' || mode === 'report-only') {
        return mode;
    }
    return 'strict';
}

async function fetchSchemaFromUrl(url) {
    let parsed;
    try {
        parsed = new URL(String(url || '').trim());
    } catch {
        throw new Error('schema_url must be a valid HTTP/HTTPS URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('schema_url must use http or https protocol');
    }
    if (parsed.username || parsed.password) {
        throw new Error('schema_url must not contain embedded credentials');
    }
    if (isBlockedHost(parsed.hostname)) {
        throw new Error('schema_url host is not permitted');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(parsed.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            redirect: 'manual',
            timeoutMs: 10000,
            signal: controller.signal
        });
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
            throw new Error('schema_url redirects are not allowed');
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch schema from ${parsed.origin}${parsed.pathname}: ${response.status}`);
        }
        const text = await response.text();
        if (text.length > 1024 * 1024) {
            throw new Error('schema_url response exceeds 1MB limit');
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function isBlockedHost(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
    if (normalized.includes(':')) {
        const clean = normalized.split('%')[0];
        const hextets = parseIpv6Hextets(clean);
        if (!hextets) return true;
        const allZero = hextets.every(part => part === 0);
        const isLoopback = hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1;
        if (allZero || isLoopback) return true;
        if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
        if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
        if (hextets.slice(0, 5).every(part => part === 0) && hextets[5] === 0xffff) return true; // ::ffff:0:0/96
        return false;
    }
    const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const [, a, b, c, d] = ipv4.map(Number);
    if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return true;
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
    const halves = address.split('::');
    if (halves.length > 2) return null;
    const parsePart = part => {
        if (!part) return [];
        const tokens = part.split(':');
        const out = [];
        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (!token) return null;
            if (token.includes('.')) {
                if (i !== tokens.length - 1) return null;
                const v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
                if (!v4) return null;
                const octets = v4.slice(1).map(Number);
                if (octets.some(o => o < 0 || o > 255)) return null;
                out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
            } else {
                if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
                out.push(parseInt(token, 16));
            }
        }
        return out;
    };
    const left = parsePart(halves[0]);
    if (!left) return null;
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    const right = parsePart(halves[1]);
    if (!right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array(missing).fill(0), ...right];
}

function validateArray(data, schema, config) {
    const results = [];

    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const itemResult = validateItem(item, schema, config, i);
        results.push(itemResult);

        if (config.stop_on_first_error && !itemResult.valid) {
            break;
        }
    }

    return results;
}

function validateObject(data, schema, config) {
    const result = validateItem(data, schema, config, 0);
    return [result];
}

function validateItem(item, schema, config, index) {
    const errors = [];
    const warnings = [];

    // Schema validation
    if (schema) {
        const schemaErrors = validateAgainstSchema(item, schema);
        errors.push(...schemaErrors);
    }

    // Required fields validation
    if (config.required_fields.length > 0) {
        const requiredErrors = validateRequiredFields(item, config.required_fields);
        errors.push(...requiredErrors);
    }

    // Data types validation
    if (Object.keys(config.data_types).length > 0) {
        const typeErrors = validateDataTypes(item, config.data_types);
        errors.push(...typeErrors);
    }

    // Custom rules validation
    if (config.custom_rules.length > 0) {
        const customErrors = validateCustomRules(item, config.custom_rules);
        errors.push(...customErrors);
    }

    // Data quality checks
    const qualityWarnings = performDataQualityChecks(item);
    warnings.push(...qualityWarnings);

    const isValid = errors.length === 0;

    return {
        index: index,
        valid: isValid,
        errors: errors,
        warnings: warnings,
        data: item
    };
}

function validateAgainstSchema(item, schema) {
    try {
        return validateSchemaValue(item, schema, 'root', schema);
    } catch (error) {
        const errors = [];
        errors.push({
            field: 'schema',
            rule: 'validation',
            message: `Schema validation error: ${error.message}`,
            severity: 'error'
        });
        return errors;
    }
}

function validateSchemaValue(value, schema, path, rootSchema) {
    if (schema === true || schema === undefined || schema === null) return [];
    if (schema === false) {
        return [schemaError(path, 'schema', 'Value is not allowed by schema')];
    }
    if (typeof schema !== 'object') {
        return [schemaError(path, 'schema', 'Schema must be an object or boolean')];
    }

    const resolvedSchema = schema.$ref ? resolveSchemaRef(rootSchema, schema.$ref) : schema;
    if (resolvedSchema !== schema) {
        return validateSchemaValue(value, resolvedSchema, path, rootSchema);
    }

    const errors = [];

    if (resolvedSchema.type !== undefined && !matchesSchemaType(value, resolvedSchema.type)) {
        errors.push(schemaError(
            path,
            'type',
            `Expected type ${formatExpectedTypes(resolvedSchema.type)}, got ${jsonTypeOf(value)}`
        ));
        return errors;
    }

    if (resolvedSchema.const !== undefined && !deepEqual(value, resolvedSchema.const)) {
        errors.push(schemaError(path, 'const', 'Value does not match const'));
    }

    if (Array.isArray(resolvedSchema.enum) && !resolvedSchema.enum.some(entry => deepEqual(value, entry))) {
        errors.push(schemaError(path, 'enum', 'Value is not one of the allowed enum values'));
    }

    if (resolvedSchema.allOf) {
        for (const subSchema of ensureArray(resolvedSchema.allOf)) {
            errors.push(...validateSchemaValue(value, subSchema, path, rootSchema));
        }
    }

    if (resolvedSchema.anyOf) {
        const candidates = ensureArray(resolvedSchema.anyOf);
        if (!candidates.some(subSchema => validateSchemaValue(value, subSchema, path, rootSchema).length === 0)) {
            errors.push(schemaError(path, 'anyOf', 'Value does not match any allowed schema'));
        }
    }

    if (resolvedSchema.oneOf) {
        const candidates = ensureArray(resolvedSchema.oneOf);
        const matches = candidates.filter(subSchema => validateSchemaValue(value, subSchema, path, rootSchema).length === 0);
        if (matches.length !== 1) {
            errors.push(schemaError(path, 'oneOf', `Value must match exactly one schema, matched ${matches.length}`));
        }
    }

    if (resolvedSchema.not && validateSchemaValue(value, resolvedSchema.not, path, rootSchema).length === 0) {
        errors.push(schemaError(path, 'not', 'Value matches a schema it must not match'));
    }

    if (typeof value === 'string') {
        validateStringConstraints(value, resolvedSchema, path, errors);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
        validateNumberConstraints(value, resolvedSchema, path, errors);
    } else if (Array.isArray(value)) {
        validateArrayConstraints(value, resolvedSchema, path, rootSchema, errors);
    } else if (isPlainObject(value)) {
        validateObjectConstraints(value, resolvedSchema, path, rootSchema, errors);
    }

    return errors;
}

function validateStringConstraints(value, schema, path, errors) {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(schemaError(path, 'minLength', `String length must be at least ${schema.minLength}`));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(schemaError(path, 'maxLength', `String length must be at most ${schema.maxLength}`));
    }
    if (schema.pattern !== undefined) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
            errors.push(schemaError(path, 'pattern', `String does not match pattern ${schema.pattern}`));
        }
    }
    if (schema.format && !matchesFormat(value, schema.format)) {
        errors.push(schemaError(path, 'format', `String does not match format ${schema.format}`));
    }
}

function validateNumberConstraints(value, schema, path, errors) {
    if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(schemaError(path, 'minimum', `Number must be greater than or equal to ${schema.minimum}`));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(schemaError(path, 'maximum', `Number must be less than or equal to ${schema.maximum}`));
    }
    if (schema.exclusiveMinimum !== undefined) {
        const limit = schema.exclusiveMinimum === true ? schema.minimum : schema.exclusiveMinimum;
        if (limit !== undefined && value <= limit) {
            errors.push(schemaError(path, 'exclusiveMinimum', `Number must be greater than ${limit}`));
        }
    }
    if (schema.exclusiveMaximum !== undefined) {
        const limit = schema.exclusiveMaximum === true ? schema.maximum : schema.exclusiveMaximum;
        if (limit !== undefined && value >= limit) {
            errors.push(schemaError(path, 'exclusiveMaximum', `Number must be less than ${limit}`));
        }
    }
    if (schema.multipleOf !== undefined && !isMultipleOf(value, schema.multipleOf)) {
        errors.push(schemaError(path, 'multipleOf', `Number must be a multiple of ${schema.multipleOf}`));
    }
}

function validateArrayConstraints(value, schema, path, rootSchema, errors) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(schemaError(path, 'minItems', `Array must contain at least ${schema.minItems} item(s)`));
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(schemaError(path, 'maxItems', `Array must contain at most ${schema.maxItems} item(s)`));
    }
    if (schema.uniqueItems && !arrayItemsUnique(value)) {
        errors.push(schemaError(path, 'uniqueItems', 'Array items must be unique'));
    }

    if (Array.isArray(schema.items)) {
        schema.items.forEach((itemSchema, index) => {
            if (index < value.length) {
                errors.push(...validateSchemaValue(value[index], itemSchema, `${path}[${index}]`, rootSchema));
            }
        });
        if (schema.additionalItems === false && value.length > schema.items.length) {
            errors.push(schemaError(path, 'additionalItems', 'Array contains additional tuple items'));
        } else if (schema.additionalItems && typeof schema.additionalItems === 'object') {
            value.slice(schema.items.length).forEach((item, offset) => {
                const index = schema.items.length + offset;
                errors.push(...validateSchemaValue(item, schema.additionalItems, `${path}[${index}]`, rootSchema));
            });
        }
    } else if (schema.items && typeof schema.items === 'object') {
        value.forEach((item, index) => {
            errors.push(...validateSchemaValue(item, schema.items, `${path}[${index}]`, rootSchema));
        });
    }

    if (schema.contains) {
        const matchCount = value.filter(item => validateSchemaValue(item, schema.contains, path, rootSchema).length === 0).length;
        const minContains = schema.minContains === undefined ? 1 : schema.minContains;
        if (matchCount < minContains) {
            errors.push(schemaError(path, 'contains', `Array must contain at least ${minContains} matching item(s)`));
        }
        if (schema.maxContains !== undefined && matchCount > schema.maxContains) {
            errors.push(schemaError(path, 'contains', `Array must contain at most ${schema.maxContains} matching item(s)`));
        }
    }
}

function validateObjectConstraints(value, schema, path, rootSchema, errors) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
        errors.push(schemaError(path, 'minProperties', `Object must have at least ${schema.minProperties} property/properties`));
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
        errors.push(schemaError(path, 'maxProperties', `Object must have at most ${schema.maxProperties} property/properties`));
    }

    if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                errors.push(schemaError(joinPath(path, key), 'required', `Required property ${key} is missing`));
            }
        }
    }

    const validatedKeys = new Set();
    if (schema.properties && typeof schema.properties === 'object') {
        for (const key of Object.keys(schema.properties)) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                validatedKeys.add(key);
                errors.push(...validateSchemaValue(value[key], schema.properties[key], joinPath(path, key), rootSchema));
            }
        }
    }

    if (schema.patternProperties && typeof schema.patternProperties === 'object') {
        for (const pattern of Object.keys(schema.patternProperties)) {
            const regex = new RegExp(pattern);
            for (const key of keys) {
                if (regex.test(key)) {
                    validatedKeys.add(key);
                    errors.push(...validateSchemaValue(value[key], schema.patternProperties[pattern], joinPath(path, key), rootSchema));
                }
            }
        }
    }

    if (schema.propertyNames) {
        for (const key of keys) {
            errors.push(...validateSchemaValue(key, schema.propertyNames, `${path} property name`, rootSchema));
        }
    }

    const extras = keys.filter(key => !validatedKeys.has(key));
    if (schema.additionalProperties === false && schema.properties) {
        for (const key of extras) {
            errors.push(schemaError(joinPath(path, key), 'additionalProperties', `Additional property ${key} is not allowed`));
        }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        for (const key of extras) {
            errors.push(...validateSchemaValue(value[key], schema.additionalProperties, joinPath(path, key), rootSchema));
        }
    }

    if (schema.dependencies && typeof schema.dependencies === 'object') {
        for (const key of Object.keys(schema.dependencies)) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            const dependency = schema.dependencies[key];
            if (Array.isArray(dependency)) {
                for (const requiredKey of dependency) {
                    if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
                        errors.push(schemaError(joinPath(path, requiredKey), 'dependencies', `Property ${requiredKey} is required when ${key} is present`));
                    }
                }
            } else if (dependency && typeof dependency === 'object') {
                errors.push(...validateSchemaValue(value, dependency, path, rootSchema));
            }
        }
    }
}

function schemaError(field, rule, message) {
    return {
        field,
        rule,
        message,
        severity: 'error'
    };
}

function resolveSchemaRef(rootSchema, ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#')) {
        throw new Error(`Only local JSON Schema $ref values are supported: ${ref}`);
    }
    if (ref === '#') return rootSchema;
    const parts = ref
        .slice(2)
        .split('/')
        .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current = rootSchema;
    for (const part of parts) {
        if (!current || typeof current !== 'object' || !(part in current)) {
            throw new Error(`Unable to resolve JSON Schema $ref ${ref}`);
        }
        current = current[part];
    }
    return current;
}

function matchesSchemaType(value, expectedType) {
    return ensureArray(expectedType).some(type => {
        switch (type) {
            case 'null':
                return value === null;
            case 'boolean':
                return typeof value === 'boolean';
            case 'object':
                return isPlainObject(value);
            case 'array':
                return Array.isArray(value);
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'integer':
                return Number.isInteger(value);
            case 'string':
                return typeof value === 'string';
            default:
                return false;
        }
    });
}

function jsonTypeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
}

function formatExpectedTypes(type) {
    return ensureArray(type).join(' or ');
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [value];
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinPath(path, key) {
    return path ? `${path}.${key}` : key;
}

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function arrayItemsUnique(items) {
    const seen = new Set();
    for (const item of items) {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
}

function isMultipleOf(value, divisor) {
    if (typeof divisor !== 'number' || divisor === 0) return false;
    const quotient = value / divisor;
    return Math.abs(quotient - Math.round(quotient)) < Number.EPSILON * 100;
}

function matchesFormat(value, format) {
    switch (format) {
        case 'email':
        case 'idn-email':
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        case 'uri':
        case 'url':
        case 'iri':
            try {
                new URL(value);
                return true;
            } catch {
                return false;
            }
        case 'date-time':
            return !Number.isNaN(Date.parse(value));
        case 'date':
            return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
        case 'time':
            return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-][0-2]\d:[0-5]\d)?$/.test(value);
        case 'uuid':
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        case 'hostname':
            return /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value);
        case 'ipv4':
            return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value);
        case 'ipv6':
            return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
        default:
            return true;
    }
}

function validateRequiredFields(item, requiredFields) {
    const errors = [];

    requiredFields.forEach(field => {
        const value = getNestedValue(item, field);
        if (value === undefined || value === null || value === '') {
            errors.push({
                field: field,
                rule: 'required',
                message: `Required field ${field} is missing or empty`,
                severity: 'error'
            });
        }
    });

    return errors;
}

function validateDataTypes(item, dataTypes) {
    const errors = [];

    Object.keys(dataTypes).forEach(field => {
        const expectedType = dataTypes[field];
        const value = getNestedValue(item, field);

        if (value !== undefined && !matchesSchemaType(value, expectedType)) {
            errors.push({
                field: field,
                rule: 'datatype',
                message: `Field ${field} should be ${formatExpectedTypes(expectedType)}, got ${jsonTypeOf(value)}`,
                severity: 'error'
            });
        }
    });

    return errors;
}

function validateCustomRules(item, customRules) {
    const errors = [];

    customRules.forEach(rule => {
        const value = getNestedValue(item, rule.field);
        let isValid = true;

        try {
            switch (rule.rule) {
                case 'email':
                    isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
                    break;
                case 'url':
                    isValid = /^https?:\/\/.+/.test(value);
                    break;
                case 'not-empty':
                    isValid = value !== undefined && value !== null && value !== '';
                    break;
                case 'numeric':
                    isValid =
                        (typeof value === 'number' && Number.isFinite(value)) ||
                        (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
                    break;
                case 'positive':
                    isValid = typeof value === 'number' && value > 0;
                    break;
                default:
                    isValid = false;
            }
        } catch (error) {
            isValid = false;
        }

        if (!isValid) {
            errors.push({
                field: rule.field,
                rule: rule.rule,
                message: rule.message || `Field ${rule.field} failed ${rule.rule} validation`,
                severity: 'error'
            });
        }
    });

    return errors;
}

function performDataQualityChecks(item) {
    const warnings = [];

    if (typeof item === 'object' && item !== null) {
        // Check for empty strings
        Object.keys(item).forEach(key => {
            const value = item[key];
            if (typeof value === 'string' && value.trim() === '') {
                warnings.push({
                    field: key,
                    rule: 'data-quality',
                    message: `Field ${key} contains only whitespace`,
                    severity: 'warning'
                });
            }
        });

        // Check for suspicious patterns
        const suspiciousValues = ['null', 'undefined', 'N/A', 'n/a', 'NULL', 'nil'];
        Object.keys(item).forEach(key => {
            const value = item[key];
            if (typeof value === 'string' && suspiciousValues.includes(value)) {
                warnings.push({
                    field: key,
                    rule: 'data-quality',
                    message: `Field ${key} contains suspicious value: ${value}`,
                    severity: 'warning'
                });
            }
        });
    }

    return warnings;
}

function isSafeKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function getNestedValue(obj, path) {
    return String(path || '').split('.').reduce((current, key) => {
        if (!current || typeof current !== 'object' || !isSafeKey(key) || !Object.hasOwn(current, key)) {
            return undefined;
        }
        return current[key];
    }, obj);
}

function generateValidationSummary(results) {
    const total = results.length;
    const valid = results.filter(r => r.valid).length;
    const invalid = total - valid;

    const allErrors = results.flatMap(r => r.errors);
    const allWarnings = results.flatMap(r => r.warnings);

    const errorsByRule = {};
    allErrors.forEach(error => {
        errorsByRule[error.rule] = (errorsByRule[error.rule] || 0) + 1;
    });

    return {
        total_count: total,
        valid_count: valid,
        invalid_count: invalid,
        error_count: allErrors.length,
        warning_count: allWarnings.length,
        validation_rate: total > 0 ? Math.round((valid / total) * 100) : 100,
        error_breakdown: errorsByRule
    };
}

function mergeObjects(base, extra) {
    const result = {};
    for (const source of [base, extra]) {
        if (!source || typeof source !== 'object') continue;
        for (const key of Object.keys(source)) {
            if (isSafeKey(key)) {
                result[key] = source[key];
            }
        }
    }
    return result;
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
