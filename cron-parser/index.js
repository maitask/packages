/**
 * @maitask/cron-parser
 * Cron expression parser and scheduler
 *
 * Features:
 * - Parse standard cron expressions (5 or 6 fields)
 * - Calculate next execution times
 * - Validate cron syntax
 * - Support ranges, lists, steps
 * - Human-readable descriptions
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input cron expression or config
 * @param {Object} options - Parser options
 * @param {Object} context - Execution context
 * @returns {Object} Parsed cron data
 */
function execute(input, options = {}, context = {}) {
    try {
        const expression = ensureExpression(input);
        const operation = options.operation || 'parse';

        let result;
        switch (operation) {
            case 'parse':
                result = parseCron(expression);
                break;
            case 'next':
                result = getNextRuns(expression, options.count || 5, options.from);
                break;
            case 'validate':
                result = validateCron(expression);
                break;
            case 'describe':
                result = describeCron(expression);
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }

        return {
            success: true,
            expression,
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
                message: error.message || 'Cron parsing error',
                code: 'CRON_ERROR',
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
 * Ensure input is cron expression string
 */
function ensureExpression(input) {
    if (typeof input === 'string') {
        return input.trim();
    }

    if (input && typeof input.expression === 'string') {
        return input.expression.trim();
    }

    if (input && typeof input.cron === 'string') {
        return input.cron.trim();
    }

    throw new Error('Invalid input: cron expression string expected');
}

/**
 * Parse cron expression
 */
function parseCron(expression) {
    const parts = expression.split(/\s+/);

    if (parts.length < 5 || parts.length > 6) {
        throw new Error('Invalid cron expression: expected 5 or 6 fields');
    }

    const hasSeconds = parts.length === 6;
    const offset = hasSeconds ? 0 : -1;

    return {
        seconds: hasSeconds ? parseField(parts[0], 0, 59) : { values: [0] },
        minutes: parseField(parts[offset + 1], 0, 59),
        hours: parseField(parts[offset + 2], 0, 23),
        dayOfMonth: parseField(parts[offset + 3], 1, 31),
        month: parseField(parts[offset + 4], 1, 12),
        dayOfWeek: parseField(parts[offset + 5], 0, 6),
        hasSeconds
    };
}

/**
 * Parse single cron field
 */
function parseField(field, min, max) {
    if (field === '*') {
        return { type: 'all', values: null };
    }

    if (field.includes('/')) {
        const [range, step] = field.split('/');
        const stepNum = parseInt(step);

        if (isNaN(stepNum) || stepNum < 1) {
            throw new Error(`Invalid step: ${step}`);
        }

        const values = [];
        const start = range === '*' ? min : parseInt(range);
        for (let i = start; i <= max; i += stepNum) {
            values.push(i);
        }

        return { type: 'step', values, step: stepNum };
    }

    if (field.includes(',')) {
        const values = field.split(',').map(v => {
            const num = parseInt(v);
            if (isNaN(num) || num < min || num > max) {
                throw new Error(`Invalid value: ${v}`);
            }
            return num;
        });

        return { type: 'list', values };
    }

    if (field.includes('-')) {
        const [start, end] = field.split('-').map(v => parseInt(v));

        if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
            throw new Error(`Invalid range: ${field}`);
        }

        const values = [];
        for (let i = start; i <= end; i++) {
            values.push(i);
        }

        return { type: 'range', values };
    }

    const value = parseInt(field);
    if (isNaN(value) || value < min || value > max) {
        throw new Error(`Invalid value: ${field} (expected ${min}-${max})`);
    }

    return { type: 'value', values: [value] };
}

/**
 * Get next N execution times
 */
function getNextRuns(expression, count = 5, from) {
    const parsed = parseCron(expression);
    const start = from ? new Date(from) : new Date();
    const runs = [];

    let current = new Date(start);
    current.setMilliseconds(0);

    if (!parsed.hasSeconds) {
        current.setSeconds(0);
    }

    let iterations = 0;
    const maxIterations = count * 366 * 24 * 60;

    while (runs.length < count && iterations < maxIterations) {
        iterations++;

        if (matchesCron(current, parsed)) {
            runs.push(new Date(current));
        }

        if (parsed.hasSeconds) {
            current.setSeconds(current.getSeconds() + 1);
        } else {
            current.setMinutes(current.getMinutes() + 1);
        }
    }

    return runs.map(d => d.toISOString());
}

/**
 * Check if date matches cron expression
 */
function matchesCron(date, parsed) {
    const matches = (field, value) => {
        if (!field.values) return true;
        return field.values.includes(value);
    };

    return matches(parsed.seconds, date.getSeconds()) &&
           matches(parsed.minutes, date.getMinutes()) &&
           matches(parsed.hours, date.getHours()) &&
           matches(parsed.dayOfMonth, date.getDate()) &&
           matches(parsed.month, date.getMonth() + 1) &&
           matches(parsed.dayOfWeek, date.getDay());
}

/**
 * Validate cron expression
 */
function validateCron(expression) {
    try {
        parseCron(expression);
        return {
            valid: true,
            message: 'Valid cron expression'
        };
    } catch (error) {
        return {
            valid: false,
            message: error.message
        };
    }
}

/**
 * Describe cron expression in human-readable format
 */
function describeCron(expression) {
    const parsed = parseCron(expression);
    const parts = [];

    const describeField = (field, names) => {
        if (!field.values) return 'every ' + names.unit;

        if (field.values.length === 1) {
            return names.format ? names.format(field.values[0]) : field.values[0];
        }

        if (field.type === 'step') {
            return `every ${field.step} ${names.unit}`;
        }

        if (field.values.length === 2) {
            const v1 = names.format ? names.format(field.values[0]) : field.values[0];
            const v2 = names.format ? names.format(field.values[1]) : field.values[1];
            return `${v1} and ${v2}`;
        }

        return field.values.map(v => names.format ? names.format(v) : v).join(', ');
    };

    const minuteDesc = describeField(parsed.minutes, { unit: 'minute' });
    const hourDesc = describeField(parsed.hours, { unit: 'hour' });
    const monthDesc = describeField(parsed.month, {
        unit: 'month',
        format: m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
    });
    const dowDesc = describeField(parsed.dayOfWeek, {
        unit: 'day',
        format: d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]
    });

    if (parsed.minutes.values && parsed.minutes.values.length === 1 &&
        parsed.hours.values && parsed.hours.values.length === 1) {
        const hour = parsed.hours.values[0];
        const minute = parsed.minutes.values[0];
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        parts.push(`At ${time}`);
    } else {
        if (minuteDesc !== 'every minute') parts.push(minuteDesc);
        if (hourDesc !== 'every hour') parts.push(hourDesc);
    }

    if (monthDesc !== 'every month') parts.push(`in ${monthDesc}`);
    if (dowDesc !== 'every day') parts.push(`on ${dowDesc}`);

    return parts.join(', ') || 'Every minute';
}
