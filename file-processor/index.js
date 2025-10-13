/**
 * @maitask/file-processor
 * Powerful data processing and transformation engine
 *
 * Features:
 * - Data transformation with flexible mapping rules
 * - Advanced filtering with multiple operators
 * - Aggregation operations (sum, count, average, etc.)
 * - Multi-step processing pipelines
 * - Sorting and limiting capabilities
 * - Preprocessing (deduplication, flattening, cleanup)
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for data processing
 * @param {Object|Array|string} input - Input data to process
 * @param {Object} options - Processing configuration
 * @param {Object} context - Execution context
 * @returns {Object} Processing result with transformed data
 */
function execute(input, options, context) {
    var resolvedOptions = normalizeOptions(options, input, context);
    var operation = (resolvedOptions.operation || 'transform').toLowerCase();
    var data = normalizeInput(input);
    var metadata = {
        operation: operation,
        inputCount: data.length,
        steps: [],
        executedAt: new Date().toISOString(),
        version: '0.1.0'
    };

    var working = data.slice();
    if (resolvedOptions.preprocess) {
        working = applyPreprocess(working, resolvedOptions.preprocess, metadata);
    }

    var result;
    if (resolvedOptions.pipeline && Array.isArray(resolvedOptions.pipeline) && resolvedOptions.pipeline.length > 0) {
        result = runPipeline(working, resolvedOptions.pipeline, metadata);
    } else {
        switch (operation) {
            case 'transform':
                result = applyTransform(working, resolvedOptions.transformRules || resolvedOptions.transforms || {});
                break;
            case 'filter':
                result = applyFilters(working, resolvedOptions.filterRules || resolvedOptions.filters || []);
                break;
            case 'aggregate':
                result = applyAggregations(working, resolvedOptions.aggregateRules || resolvedOptions.aggregations || {});
                break;
            case 'pipeline':
                result = runPipeline(working, resolvedOptions.steps || [], metadata);
                break;
            default:
                throw new Error('Unsupported operation: ' + operation);
        }
    }

    if (resolvedOptions.sort && Array.isArray(result)) {
        result = applySort(result, resolvedOptions.sort);
        metadata.steps.push({ type: 'sort', details: resolvedOptions.sort });
    }

    if (typeof resolvedOptions.limit === 'number' && Array.isArray(result)) {
        result = result.slice(0, resolvedOptions.limit);
        metadata.steps.push({ type: 'limit', count: resolvedOptions.limit });
    }

    metadata.outputCount = Array.isArray(result) ? result.length : 1;
    metadata.fields = inferFields(Array.isArray(result) ? result : [result]);

    return {
        success: true,
        operation: operation,
        result: result,
        metadata: metadata
    };
}

function normalizeOptions(options, input, context) {
    var merged = isPlainObject(options) ? deepClone(options) : {};

    if (input && typeof input === 'object') {
        if (isPlainObject(input.__options)) {
            merged = deepMerge(merged, input.__options);
        }
        if (isPlainObject(input.options)) {
            merged = deepMerge(merged, input.options);
        }
    }

    if (context && typeof context === 'object') {
        if (isPlainObject(context.defaultOptions)) {
            merged = deepMerge(context.defaultOptions, merged);
        }
    }

    return merged;
}

function normalizeInput(input) {
    if (input === null || input === undefined) {
        return [];
    }

    if (Array.isArray(input)) {
        return input.map(function (item) { return isPlainObject(item) ? deepClone(item) : item; });
    }

    if (typeof input === 'string') {
        var trimmed = input.trim();
        if (!trimmed) {
            return [];
        }

        try {
            var parsed = JSON.parse(trimmed);
            return normalizeInput(parsed);
        } catch (err) {
            var lines = trimmed.split(/\r?\n/).filter(function (line) { return line.trim().length > 0; });
            return lines.map(function (line, index) {
                return { line: line, index: index };
            });
        }
    }

    if (isPlainObject(input)) {
        if (Array.isArray(input.rows)) {
            return normalizeInput(input.rows);
        }
        if (Array.isArray(input.records)) {
            return normalizeInput(input.records);
        }
        if (Array.isArray(input.data)) {
            return normalizeInput(input.data);
        }
        return [deepClone(input)];
    }

    return [{ value: input }];
}

function applyPreprocess(data, config, metadata) {
    var configList = Array.isArray(config) ? config : [config];
    var working = data.slice();

    for (var i = 0; i < configList.length; i++) {
        var step = configList[i];
        if (!isPlainObject(step)) {
            continue;
        }

        var kind = (step.type || step.name || '').toLowerCase();
        if (kind === 'deduplicate' || kind === 'dedupe') {
            var seen = {};
            var keys = step.keys || (step.key ? [step.key] : []);
            var unique = [];
            for (var j = 0; j < working.length; j++) {
                var item = working[j];
                var signature = keys.length > 0 ? keys.map(function (key) { return stringifySafe(getByPath(item, key)); }).join('::') : stringifySafe(item);
                if (!seen[signature]) {
                    seen[signature] = true;
                    unique.push(item);
                }
            }
            working = unique;
            metadata.steps.push({ type: 'deduplicate', keys: keys });
        } else if (kind === 'remove_empty' || kind === 'compact') {
            working = working.filter(function (item) {
                if (item === null || item === undefined) {
                    return false;
                }
                if (!isPlainObject(item)) {
                    return true;
                }
                var keys = Object.keys(item);
                for (var k = 0; k < keys.length; k++) {
                    var value = item[keys[k]];
                    if (value !== null && value !== undefined && String(value).trim() !== '') {
                        return true;
                    }
                }
                return false;
            });
            metadata.steps.push({ type: 'remove_empty' });
        } else if (kind === 'flatten') {
            var field = step.field || step.path;
            var flattened = [];
            for (var m = 0; m < working.length; m++) {
                var row = working[m];
                var nestedValues = field ? getByPath(row, field) : row;
                if (Array.isArray(nestedValues)) {
                    for (var n = 0; n < nestedValues.length; n++) {
                        var merged = deepClone(row);
                        if (field) {
                            setByPath(merged, field, nestedValues[n]);
                        }
                        flattened.push(merged);
                    }
                } else {
                    flattened.push(row);
                }
            }
            working = flattened;
            metadata.steps.push({ type: 'flatten', field: field });
        }
    }

    return working;
}

function runPipeline(data, steps, metadata) {
    var current = data.slice();
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        if (!isPlainObject(step)) {
            continue;
        }

        var type = (step.type || '').toLowerCase();
        if (!type && step.transformRules) {
            type = 'transform';
        }

        if (type === 'transform') {
            current = applyTransform(current, step.rules || step.transformRules || step.config || step);
        } else if (type === 'filter') {
            current = applyFilters(current, step.rules || step.conditions || step.filterRules || step);
        } else if (type === 'aggregate') {
            current = applyAggregations(current, step.rules || step.aggregateRules || step);
        } else if (type === 'sort') {
            current = applySort(current, step.by || step.fields || step);
        } else if (type === 'limit') {
            var count = typeof step.count === 'number' ? step.count : step.limit;
            if (typeof count === 'number' && Array.isArray(current)) {
                current = current.slice(0, count);
            }
        } else if (type === 'map') {
            current = applyTransform(current, { fields: step.fields || [] });
        }

        metadata.steps.push({ type: type || 'unknown', details: step });
    }
    return current;
}

function applyTransform(data, rules) {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    if (!rules) {
        return data.map(function (item) { return deepClone(item); });
    }

    if (Array.isArray(rules.fields)) {
        return data.map(function (item) {
            return buildTransformedRecord(item, rules.fields, rules.defaults || {});
        });
    }

    if (isPlainObject(rules)) {
        var keys = Object.keys(rules);
        return data.map(function (item) {
            var record = {};
            for (var i = 0; i < keys.length; i++) {
                var targetKey = keys[i];
                var descriptor = rules[targetKey];
                record[targetKey] = resolveRuleValue(item, descriptor, targetKey);
            }
            return record;
        });
    }

    return data.map(function (item) { return deepClone(item); });
}

function buildTransformedRecord(item, fields, defaults) {
    var output = {};
    for (var i = 0; i < fields.length; i++) {
        var spec = fields[i];
        if (!isPlainObject(spec)) {
            continue;
        }
        var target = spec.to || spec.as || spec.name;
        if (!target) {
            continue;
        }
        var value = resolveRuleValue(item, spec, target);
        if ((value === undefined || value === null || value === '') && spec.hasOwnProperty('default')) {
            value = spec.default;
        }
        output[target] = value;
    }

    if (isPlainObject(defaults)) {
        var defaultKeys = Object.keys(defaults);
        for (var j = 0; j < defaultKeys.length; j++) {
            var key = defaultKeys[j];
            if (!output.hasOwnProperty(key)) {
                output[key] = defaults[key];
            }
        }
    }

    return output;
}

function resolveRuleValue(item, descriptor, fallbackKey) {
    if (descriptor === null || descriptor === undefined) {
        return undefined;
    }

    if (typeof descriptor === 'string') {
        return getByPath(item, descriptor);
    }

    if (typeof descriptor === 'function') {
        try {
            return descriptor(item, fallbackKey);
        } catch (err) {
            return undefined;
        }
    }

    if (!isPlainObject(descriptor)) {
        return descriptor;
    }

    var sourcePath = descriptor.from || descriptor.field || descriptor.path || fallbackKey;
    var value;

    if (descriptor.hasOwnProperty('value')) {
        value = descriptor.value;
    } else if (descriptor.hasOwnProperty('constant')) {
        value = descriptor.constant;
    } else if (descriptor.template) {
        value = interpolateTemplate(descriptor.template, item);
    } else if (descriptor.compute) {
        value = computeDynamicValue(item, descriptor.compute);
    } else {
        value = getByPath(item, sourcePath);
    }

    if ((value === undefined || value === null || value === '') && descriptor.hasOwnProperty('default')) {
        value = descriptor.default;
    }

    value = applyTypeConversion(value, descriptor.type, descriptor);
    value = applyValueTransforms(value, descriptor);

    if (descriptor.rename && typeof descriptor.rename === 'string') {
        var renamed = {};
        renamed[descriptor.rename] = value;
        return renamed[descriptor.rename];
    }

    return value;
}

function computeDynamicValue(item, config) {
    if (!isPlainObject(config)) {
        return undefined;
    }

    var op = (config.op || config.operation || '').toLowerCase();
    if (op === 'concat') {
        var fields = Array.isArray(config.fields) ? config.fields : [];
        var parts = [];
        for (var i = 0; i < fields.length; i++) {
            var part = getByPath(item, fields[i]);
            if (part !== null && part !== undefined) {
                parts.push(String(part));
            }
        }
        var separator = config.separator !== undefined ? String(config.separator) : '';
        return parts.join(separator);
    }

    if (op === 'sum' || op === 'avg' || op === 'average') {
        var values = [];
        var fieldList = Array.isArray(config.fields) ? config.fields : (config.field ? [config.field] : []);
        for (var j = 0; j < fieldList.length; j++) {
            var numeric = toNumber(getByPath(item, fieldList[j]));
            if (!isNaN(numeric)) {
                values.push(numeric);
            }
        }
        if (values.length === 0) {
            return undefined;
        }
        var total = 0;
        for (var k = 0; k < values.length; k++) {
            total += values[k];
        }
        if (op === 'avg' || op === 'average') {
            return total / values.length;
        }
        return total;
    }

    if (op === 'coalesce') {
        var paths = Array.isArray(config.fields) ? config.fields : [];
        for (var m = 0; m < paths.length; m++) {
            var candidate = getByPath(item, paths[m]);
            if (candidate !== undefined && candidate !== null && candidate !== '') {
                return candidate;
            }
        }
        return config.defaultValue;
    }

    if (op === 'length') {
        var targetValue = getByPath(item, config.field || config.path);
        if (typeof targetValue === 'string' || Array.isArray(targetValue)) {
            return targetValue.length;
        }
        if (isPlainObject(targetValue)) {
            return Object.keys(targetValue).length;
        }
        return 0;
    }

    if (op === 'map' && isPlainObject(config.map)) {
        var keyValue = getByPath(item, config.field || config.path);
        var mapKey = stringifySafe(keyValue);
        if (config.map.hasOwnProperty(mapKey)) {
            return config.map[mapKey];
        }
        return config.defaultValue;
    }

    return undefined;
}

function applyTypeConversion(value, type, descriptor) {
    if (!type) {
        return value;
    }
    var targetType = String(type).toLowerCase();

    if (targetType === 'string') {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    if (targetType === 'number') {
        var numeric = toNumber(value);
        if (isNaN(numeric)) {
            return descriptor.hasOwnProperty('defaultNumber') ? descriptor.defaultNumber : undefined;
        }
        return numeric;
    }

    if (targetType === 'boolean') {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            var lower = value.toLowerCase();
            if (lower === 'true' || lower === 'yes' || lower === '1') {
                return true;
            }
            if (lower === 'false' || lower === 'no' || lower === '0') {
                return false;
            }
        }
        if (typeof value === 'number') {
            return value !== 0 && !isNaN(value);
        }
        return Boolean(value);
    }

    if (targetType === 'date') {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        var date = new Date(value);
        if (isNaN(date.getTime())) {
            return null;
        }
        if (descriptor && descriptor.format === 'timestamp') {
            return date.getTime();
        }
        if (descriptor && descriptor.format === 'date') {
            return date.toISOString().split('T')[0];
        }
        return date.toISOString();
    }

    if (targetType === 'array') {
        if (Array.isArray(value)) {
            return value;
        }
        if (value === null || value === undefined) {
            return [];
        }
        if (typeof value === 'string' && descriptor && descriptor.delimiter) {
            return value.split(descriptor.delimiter).map(function (item) { return item.trim(); });
        }
        return [value];
    }

    return value;
}

function applyValueTransforms(value, descriptor) {
    if (!descriptor || value === null || value === undefined) {
        return value;
    }

    var transforms = descriptor.transform || descriptor.transforms;
    if (typeof transforms === 'string') {
        transforms = [transforms];
    }

    if (Array.isArray(transforms)) {
        for (var i = 0; i < transforms.length; i++) {
            var action = String(transforms[i]).toLowerCase();
            if (action === 'uppercase' && typeof value === 'string') {
                value = value.toUpperCase();
            } else if (action === 'lowercase' && typeof value === 'string') {
                value = value.toLowerCase();
            } else if (action === 'trim' && typeof value === 'string') {
                value = value.trim();
            } else if (action === 'slug' && typeof value === 'string') {
                value = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            }
        }
    }

    if (descriptor.multiplier && typeof descriptor.multiplier === 'number' && typeof value === 'number') {
        value = value * descriptor.multiplier;
    }

    if (descriptor.round && typeof value === 'number') {
        var precision = typeof descriptor.round === 'number' ? descriptor.round : 0;
        var factor = Math.pow(10, precision);
        value = Math.round(value * factor) / factor;
    }

    if (descriptor.split && typeof value === 'string') {
        var delimiter = descriptor.split === true ? ',' : descriptor.split;
        value = value.split(delimiter).map(function (item) { return item.trim(); });
    }

    if (descriptor.join && Array.isArray(value)) {
        value = value.join(descriptor.join === true ? ',' : descriptor.join);
    }

    return value;
}

function applyFilters(data, rules) {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    if (!rules) {
        return data.slice();
    }

    var normalized = normalizeFilterRules(rules);
    if (normalized.length === 0) {
        return data.slice();
    }

    return data.filter(function (item) {
        for (var i = 0; i < normalized.length; i++) {
            if (!evaluateFilterRule(item, normalized[i])) {
                return false;
            }
        }
        return true;
    });
}

function normalizeFilterRules(rules) {
    if (Array.isArray(rules)) {
        return rules;
    }

    if (isPlainObject(rules)) {
        var entries = [];
        var keys = Object.keys(rules);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = rules[key];
            if (isPlainObject(value) && value.hasOwnProperty('operator')) {
                var clone = deepClone(value);
                clone.field = clone.field || key;
                entries.push(clone);
            } else {
                entries.push({ field: key, operator: 'eq', value: value });
            }
        }
        return entries;
    }

    return [];
}

function evaluateFilterRule(item, rule) {
    if (!isPlainObject(rule)) {
        return true;
    }

    if (Array.isArray(rule.any)) {
        for (var i = 0; i < rule.any.length; i++) {
            if (evaluateFilterRule(item, rule.any[i])) {
                return true;
            }
        }
        return false;
    }

    if (Array.isArray(rule.all)) {
        for (var j = 0; j < rule.all.length; j++) {
            if (!evaluateFilterRule(item, rule.all[j])) {
                return false;
            }
        }
        return true;
    }

    if (rule.not) {
        return !evaluateFilterRule(item, rule.not);
    }

    var field = rule.field || rule.key;
    var operator = (rule.operator || 'eq').toLowerCase();
    var expected = rule.value;
    var actual = getByPath(item, field);

    if (operator === 'eq' || operator === '===' || operator === 'equals') {
        return stringifySafe(actual) === stringifySafe(expected);
    }

    if (operator === 'neq' || operator === '!=' || operator === 'not_equals') {
        return stringifySafe(actual) !== stringifySafe(expected);
    }

    if (operator === 'exists') {
        return actual !== undefined && actual !== null;
    }

    if (operator === 'missing') {
        return actual === undefined || actual === null;
    }

    if (operator === 'gt' || operator === 'greater_than') {
        return toNumber(actual) > toNumber(expected);
    }

    if (operator === 'gte' || operator === 'greater_or_equal') {
        return toNumber(actual) >= toNumber(expected);
    }

    if (operator === 'lt' || operator === 'less_than') {
        return toNumber(actual) < toNumber(expected);
    }

    if (operator === 'lte' || operator === 'less_or_equal') {
        return toNumber(actual) <= toNumber(expected);
    }

    if (operator === 'contains') {
        if (typeof actual === 'string') {
            return actual.indexOf(String(expected)) !== -1;
        }
        if (Array.isArray(actual)) {
            return indexOfValue(actual, expected) !== -1;
        }
        return false;
    }

    if (operator === 'not_contains') {
        return !evaluateFilterRule(item, { field: field, operator: 'contains', value: expected });
    }

    if (operator === 'starts_with') {
        return typeof actual === 'string' && actual.indexOf(String(expected)) === 0;
    }

    if (operator === 'ends_with') {
        if (typeof actual !== 'string') {
            return false;
        }
        var suffix = String(expected);
        return actual.slice(-suffix.length) === suffix;
    }

    if (operator === 'in') {
        var list = Array.isArray(expected) ? expected : [expected];
        return indexOfValue(list, actual) !== -1;
    }

    if (operator === 'not_in') {
        return !evaluateFilterRule(item, { field: field, operator: 'in', value: expected });
    }

    if (operator === 'between') {
        var min = rule.min !== undefined ? rule.min : (Array.isArray(expected) ? expected[0] : undefined);
        var max = rule.max !== undefined ? rule.max : (Array.isArray(expected) ? expected[1] : undefined);
        var numeric = toNumber(actual);
        if (min !== undefined && numeric < toNumber(min)) {
            return false;
        }
        if (max !== undefined && numeric > toNumber(max)) {
            return false;
        }
        return true;
    }

    if (operator === 'regex' || operator === 'matches') {
        try {
            var pattern = typeof expected === 'string' ? expected : String(expected);
            var regex = new RegExp(pattern, rule.flags || 'i');
            return regex.test(String(actual));
        } catch (err) {
            return false;
        }
    }

    return true;
}

function applyAggregations(data, rules) {
    if (!Array.isArray(data) || data.length === 0) {
        return [];
    }

    var config = normalizeAggregationRules(rules);
    if (config.metrics.length === 0) {
        throw new Error('No aggregation metrics specified');
    }

    if (config.groupBy.length === 0) {
        return computeAggregateForGroup(data, config.metrics);
    }

    var groups = {};
    for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var keyParts = [];
        for (var g = 0; g < config.groupBy.length; g++) {
            keyParts.push(stringifySafe(getByPath(row, config.groupBy[g])));
        }
        var signature = keyParts.join('::');
        if (!groups[signature]) {
            groups[signature] = { rows: [], keyParts: keyParts };
        }
        groups[signature].rows.push(row);
    }

    var result = [];
    var groupKeys = Object.keys(groups);
    for (var k = 0; k < groupKeys.length; k++) {
        var group = groups[groupKeys[k]];
        var record = {};
        for (var idx = 0; idx < config.groupBy.length; idx++) {
            record[config.groupBy[idx]] = parsePossibleNumber(group.keyParts[idx]);
        }
        var metricsResult = computeAggregateForGroup(group.rows, config.metrics);
        mergeObjects(record, metricsResult);
        result.push(record);
    }

    if (config.sort) {
        result = applySort(result, config.sort);
    }

    return result;
}

function normalizeAggregationRules(rules) {
    var config = { groupBy: [], metrics: [], sort: null };

    if (!rules) {
        config.metrics.push({ op: 'count', as: 'count' });
        return config;
    }

    if (Array.isArray(rules.metrics) || Array.isArray(rules.groupBy)) {
        config.groupBy = Array.isArray(rules.groupBy) ? rules.groupBy.slice() : [];
        if (Array.isArray(rules.metrics)) {
            for (var i = 0; i < rules.metrics.length; i++) {
                var metric = normalizeMetric(rules.metrics[i]);
                if (metric) {
                    config.metrics.push(metric);
                }
            }
        }
        if (rules.sort) {
            config.sort = rules.sort;
        }
    }

    if (isPlainObject(rules)) {
        if (Array.isArray(rules.groupBy)) {
            config.groupBy = rules.groupBy.slice();
        }
        var keys = Object.keys(rules);
        for (var k = 0; k < keys.length; k++) {
            if (keys[k] === 'groupBy' || keys[k] === 'sort' || keys[k] === 'type') {
                continue;
            }
            var metricDescriptor = normalizeMetric(rules[keys[k]], keys[k]);
            if (metricDescriptor) {
                config.metrics.push(metricDescriptor);
            }
        }
        if (rules.sort) {
            config.sort = rules.sort;
        }
    }

    if (config.metrics.length === 0) {
        config.metrics.push({ op: 'count', as: 'count' });
    }

    return config;
}

function normalizeMetric(metric, fallbackName) {
    if (!metric && fallbackName) {
        return { op: 'count', as: fallbackName };
    }

    if (typeof metric === 'string') {
        var parts = metric.split(':');
        if (parts.length === 2) {
            return { op: parts[0], field: parts[1], as: fallbackName || parts[0] + '_' + parts[1] };
        }
        return { op: metric, field: fallbackName, as: fallbackName || metric };
    }

    if (isPlainObject(metric)) {
        var descriptor = {
            op: (metric.op || metric.operator || 'count').toLowerCase(),
            field: metric.field || metric.path,
            as: metric.as || metric.name || fallbackName || metric.op,
            precision: metric.precision,
            multiplier: metric.multiplier
        };
        return descriptor;
    }

    return null;
}

function computeAggregateForGroup(rows, metrics) {
    var result = {};

    for (var i = 0; i < metrics.length; i++) {
        var metric = metrics[i];
        var op = metric.op || 'count';
        var values = [];
        if (metric.field) {
            for (var j = 0; j < rows.length; j++) {
                values.push(getByPath(rows[j], metric.field));
            }
        } else {
            values = rows.slice();
        }

        var computed = computeMetric(op, values, rows.length);
        if (typeof metric.multiplier === 'number' && typeof computed === 'number') {
            computed = computed * metric.multiplier;
        }
        if (typeof metric.precision === 'number' && typeof computed === 'number') {
            var factor = Math.pow(10, metric.precision);
            computed = Math.round(computed * factor) / factor;
        }
        result[metric.as || op] = computed;
    }

    return result;
}

function computeMetric(op, values, totalCount) {
    var operation = (op || 'count').toLowerCase();

    if (operation === 'count') {
        return totalCount;
    }

    if (operation === 'count_distinct' || operation === 'distinct') {
        var seen = {};
        var unique = 0;
        for (var i = 0; i < values.length; i++) {
            var key = stringifySafe(values[i]);
            if (!seen[key]) {
                seen[key] = true;
                unique++;
            }
        }
        return unique;
    }

    var numeric = [];
    for (var j = 0; j < values.length; j++) {
        var num = toNumber(values[j]);
        if (!isNaN(num)) {
            numeric.push(num);
        }
    }

    if (numeric.length === 0) {
        return null;
    }

    if (operation === 'sum') {
        var total = 0;
        for (var k = 0; k < numeric.length; k++) {
            total += numeric[k];
        }
        return total;
    }

    if (operation === 'avg' || operation === 'average') {
        var sum = computeMetric('sum', numeric, numeric.length);
        return sum / numeric.length;
    }

    if (operation === 'min') {
        var minValue = numeric[0];
        for (var m = 1; m < numeric.length; m++) {
            if (numeric[m] < minValue) {
                minValue = numeric[m];
            }
        }
        return minValue;
    }

    if (operation === 'max') {
        var maxValue = numeric[0];
        for (var n = 1; n < numeric.length; n++) {
            if (numeric[n] > maxValue) {
                maxValue = numeric[n];
            }
        }
        return maxValue;
    }

    if (operation === 'median') {
        var sorted = numeric.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        }
        return sorted[mid];
    }

    return null;
}

function applySort(data, sortConfig) {
    if (!Array.isArray(data) || data.length === 0) {
        return data;
    }

    var criteria = Array.isArray(sortConfig) ? sortConfig : [sortConfig];
    var normalized = [];
    for (var i = 0; i < criteria.length; i++) {
        var rule = criteria[i];
        if (typeof rule === 'string') {
            normalized.push({ field: rule, direction: 'asc' });
        } else if (isPlainObject(rule)) {
            normalized.push({ field: rule.field || rule.by, direction: (rule.direction || rule.order || 'asc').toLowerCase() });
        }
    }

    if (normalized.length === 0) {
        return data;
    }

    var sorted = data.slice();
    sorted.sort(function (a, b) {
        for (var idx = 0; idx < normalized.length; idx++) {
            var spec = normalized[idx];
            var left = getByPath(a, spec.field);
            var right = getByPath(b, spec.field);
            var lhs = stringifySortable(left);
            var rhs = stringifySortable(right);
            if (lhs < rhs) {
                return spec.direction === 'desc' ? 1 : -1;
            }
            if (lhs > rhs) {
                return spec.direction === 'desc' ? -1 : 1;
            }
        }
        return 0;
    });

    return sorted;
}

function inferFields(data) {
    var set = {};
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        if (!isPlainObject(item)) {
            continue;
        }
        var keys = Object.keys(item);
        for (var k = 0; k < keys.length; k++) {
            set[keys[k]] = true;
        }
    }
    return Object.keys(set);
}

function interpolateTemplate(template, item) {
    return String(template).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, function (_, path) {
        var value = getByPath(item, path);
        return value === undefined || value === null ? '' : value;
    });
}

function getByPath(obj, path) {
    if (!path || obj === null || obj === undefined) {
        return undefined;
    }

    if (path.indexOf('.') === -1) {
        return obj[path];
    }

    var segments = path.split('.');
    var current = obj;
    for (var i = 0; i < segments.length; i++) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[segments[i]];
    }
    return current;
}

function setByPath(obj, path, value) {
    if (!path) {
        return;
    }
    var segments = path.split('.');
    var current = obj;
    for (var i = 0; i < segments.length - 1; i++) {
        var key = segments[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[segments[segments.length - 1]] = value;
}

function deepClone(value) {
    if (Array.isArray(value)) {
        return value.map(function (item) { return deepClone(item); });
    }
    if (isPlainObject(value)) {
        var clone = {};
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
            clone[keys[i]] = deepClone(value[keys[i]]);
        }
        return clone;
    }
    return value;
}

function deepMerge(target, source) {
    var output = deepClone(target);
    if (!isPlainObject(source)) {
        return output;
    }

    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var sourceValue = source[key];
        if (isPlainObject(sourceValue)) {
            if (!output[key]) {
                output[key] = {};
            }
            output[key] = deepMerge(output[key], sourceValue);
        } else if (Array.isArray(sourceValue)) {
            output[key] = sourceValue.slice();
        } else {
            output[key] = sourceValue;
        }
    }

    return output;
}

function mergeObjects(target, source) {
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
        target[keys[i]] = source[keys[i]];
    }
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function stringifySafe(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch (err) {
        return String(value);
    }
}

function stringifySortable(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'string') {
        return value;
    }
    return stringifySafe(value);
}

function toNumber(value) {
    if (value === null || value === undefined) {
        return NaN;
    }
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    var parsed = parseFloat(String(value));
    return isNaN(parsed) ? NaN : parsed;
}

function parsePossibleNumber(value) {
    if (typeof value === 'string' && value !== '' && !isNaN(value)) {
        return Number(value);
    }
    return value;
}

function indexOfValue(list, value) {
    var stringValue = stringifySafe(value);
    for (var i = 0; i < list.length; i++) {
        if (stringifySafe(list[i]) === stringValue) {
            return i;
        }
    }
    return -1;
}

execute;
