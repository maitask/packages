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
 * @version 0.1.0
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
async function execute(input, options, context) {
    console.log('Data Validator - Starting validation');

    const config = buildConfig(input, options, context);
    const data = (input && input.data) || input || [];

    if (!Array.isArray(data) && typeof data !== 'object') {
        throw new Error('Input data must be an array or object');
    }

    try {
        let schema = config.schema;

        if (config.schema_url && !schema) {
            schema = await fetchSchemaFromUrl(config.schema_url);
        }

        const validationResults = Array.isArray(data)
            ? validateArray(data, schema, config)
            : validateObject(data, schema, config);

        const summary = generateValidationSummary(validationResults);

        return {
            success: summary.valid_count === summary.total_count,
            message: `Validation completed: ${summary.valid_count}/${summary.total_count} items valid`,
            data: {
                summary: summary,
                results: validationResults,
                schema_used: !!schema,
                validation_mode: config.validation_mode
            },
            metadata: {
                validated_at: new Date().toISOString(),
                validation_mode: config.validation_mode,
                schema_source: config.schema_url ? 'url' : 'inline',
                version: '0.1.0'
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
                validated_at: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

function buildConfig(input, options, context) {
    const source = mergeObjects(options || {}, (input && input.config) || {});

    return {
        schema: source.schema,
        schema_url: source.schema_url,
        validation_mode: source.validation_mode || 'strict',
        required_fields: source.required_fields || [],
        data_types: source.data_types || {},
        custom_rules: source.custom_rules || [],
        stop_on_first_error: source.stop_on_first_error || false
    };
}

async function fetchSchemaFromUrl(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch schema from ${url}: ${response.status}`);
    }

    return await response.json();
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
    const errors = [];

    try {
        // Basic JSON Schema validation (simplified)
        if (schema.type && typeof item !== schema.type) {
            errors.push({
                field: 'root',
                rule: 'type',
                message: `Expected type ${schema.type}, got ${typeof item}`,
                severity: 'error'
            });
        }

        if (schema.properties && typeof item === 'object') {
            Object.keys(schema.properties).forEach(key => {
                const propSchema = schema.properties[key];
                const value = item[key];

                if (propSchema.type && value !== undefined && typeof value !== propSchema.type) {
                    errors.push({
                        field: key,
                        rule: 'type',
                        message: `Expected ${key} to be ${propSchema.type}, got ${typeof value}`,
                        severity: 'error'
                    });
                }

                if (propSchema.required && value === undefined) {
                    errors.push({
                        field: key,
                        rule: 'required',
                        message: `Required field ${key} is missing`,
                        severity: 'error'
                    });
                }
            });
        }

    } catch (error) {
        errors.push({
            field: 'schema',
            rule: 'validation',
            message: `Schema validation error: ${error.message}`,
            severity: 'error'
        });
    }

    return errors;
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

        if (value !== undefined && typeof value !== expectedType) {
            errors.push({
                field: field,
                rule: 'datatype',
                message: `Field ${field} should be ${expectedType}, got ${typeof value}`,
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
                    isValid = !isNaN(value) && isFinite(value);
                    break;
                case 'positive':
                    isValid = typeof value === 'number' && value > 0;
                    break;
                default:
                    console.log(`Unknown validation rule: ${rule.rule}`);
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

function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
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
    Object.assign(result, base || {});
    Object.assign(result, extra || {});
    return result;
}

execute;
