/**
 * @maitask/diff-generator
 * Data difference comparison and patch generation
 *
 * Features:
 * - JSON object comparison
 * - Text line-by-line diff
 * - Array difference detection
 * - Patch generation and application
 * - Change highlighting
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function
 * @param {Object} input - Input with old and new data
 * @param {Object} options - Diff options
 * @param {Object} context - Execution context
 * @returns {Object} Diff results
 */
function execute(input, options = {}, context = {}) {
    try {
        const { old: oldData, new: newData } = ensureInputPair(input);
        const mode = options.mode || 'auto';

        let result;
        const detectedMode = detectMode(oldData, newData, mode);

        switch (detectedMode) {
            case 'json':
                result = diffJson(oldData, newData, options);
                break;
            case 'text':
                result = diffText(oldData, newData, options);
                break;
            case 'array':
                result = diffArray(oldData, newData, options);
                break;
            default:
                throw new Error(`Unknown mode: ${detectedMode}`);
        }

        return {
            success: true,
            mode: detectedMode,
            ...result,
            metadata: {
                timestamp: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Diff generation error',
                code: 'DIFF_ERROR',
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
 * Ensure input has old and new data
 */
function ensureInputPair(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('Input is required');
    }

    const pickFirstDefined = (obj, keys) => {
        for (const key of keys) {
            if (Object.hasOwn(obj, key) && obj[key] !== undefined) {
                return obj[key];
            }
        }
        return undefined;
    };

    const oldData = pickFirstDefined(input, ['old', 'before', 'source']);
    const newData = pickFirstDefined(input, ['new', 'after', 'target']);

    if (oldData === undefined || newData === undefined) {
        throw new Error('Input must contain "old" and "new" data');
    }

    return { old: oldData, new: newData };
}

/**
 * Detect comparison mode
 */
function detectMode(oldData, newData, requestedMode) {
    if (requestedMode !== 'auto') {
        return requestedMode;
    }

    if (Array.isArray(oldData) && Array.isArray(newData)) {
        return 'array';
    }

    if (typeof oldData === 'object' && typeof newData === 'object' &&
        oldData !== null && newData !== null &&
        !Array.isArray(oldData) && !Array.isArray(newData)) {
        return 'json';
    }

    return 'text';
}

/**
 * Diff JSON objects
 */
function diffJson(oldObj, newObj, options = {}) {
    const changes = [];
    const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };

    compareObjects(oldObj, newObj, '', changes, summary);

    return {
        changes,
        summary,
        hasChanges: changes.length > 0
    };
}

/**
 * Compare two objects recursively
 */
function compareObjects(oldObj, newObj, path, changes, summary) {
    const oldKeys = Object.keys(oldObj || {});
    const newKeys = Object.keys(newObj || {});
    const allKeys = new Set([...oldKeys, ...newKeys]);

    for (const key of allKeys) {
        const currentPath = path ? `${path}.${key}` : key;
        const hasOld = oldObj != null && Object.hasOwn(oldObj, key);
        const hasNew = newObj != null && Object.hasOwn(newObj, key);
        const oldValue = hasOld ? oldObj[key] : undefined;
        const newValue = hasNew ? newObj[key] : undefined;

        if (!hasOld) {
            changes.push({
                type: 'added',
                path: currentPath,
                value: newValue
            });
            summary.added++;
        } else if (!hasNew) {
            changes.push({
                type: 'removed',
                path: currentPath,
                value: oldValue
            });
            summary.removed++;
        } else if (areEqual(oldValue, newValue)) {
            summary.unchanged++;
        } else if (isObject(oldValue) && isObject(newValue)) {
            compareObjects(oldValue, newValue, currentPath, changes, summary);
        } else {
            changes.push({
                type: 'modified',
                path: currentPath,
                oldValue,
                newValue
            });
            summary.modified++;
        }
    }
}

/**
 * Check if value is object
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if two values are equal
 */
function areEqual(a, b) {
    if (a === b) return true;

    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((val, i) => areEqual(val, b[i]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        return keysA.every(key => Object.hasOwn(b, key) && areEqual(a[key], b[key]));
    }

    return false;
}

/**
 * Diff text line by line
 */
function diffText(oldText, newText, options = {}) {
    const oldLines = String(oldText).split('\n');
    const newLines = String(newText).split('\n');

    const diff = computeLcsDiff(oldLines, newLines);

    const summary = {
        added: diff.filter(d => d.type === 'added').length,
        removed: diff.filter(d => d.type === 'removed').length,
        unchanged: diff.filter(d => d.type === 'unchanged').length
    };

    return {
        diff,
        summary,
        hasChanges: summary.added > 0 || summary.removed > 0
    };
}

/**
 * Compute diff using LCS algorithm
 */
function computeLcsDiff(oldLines, newLines) {
    const lcs = computeLcs(oldLines, newLines);
    const diff = [];

    let i = 0, j = 0, k = 0;

    while (i < oldLines.length || j < newLines.length) {
        if (k < lcs.length && i < oldLines.length && oldLines[i] === lcs[k]) {
            diff.push({
                type: 'unchanged',
                line: oldLines[i],
                oldLineNo: i + 1,
                newLineNo: j + 1
            });
            i++;
            j++;
            k++;
        } else if (k < lcs.length && j < newLines.length && newLines[j] === lcs[k]) {
            diff.push({
                type: 'added',
                line: newLines[j],
                newLineNo: j + 1
            });
            j++;
        } else if (i < oldLines.length) {
            diff.push({
                type: 'removed',
                line: oldLines[i],
                oldLineNo: i + 1
            });
            i++;
        } else {
            diff.push({
                type: 'added',
                line: newLines[j],
                newLineNo: j + 1
            });
            j++;
        }
    }

    return diff;
}

/**
 * Compute Longest Common Subsequence
 */
function computeLcs(arr1, arr2) {
    let prefixLen = 0;
    const minLen = Math.min(arr1.length, arr2.length);
    while (prefixLen < minLen && arr1[prefixLen] === arr2[prefixLen]) {
        prefixLen++;
    }
    let suffixLen = 0;
    while (
        suffixLen < minLen - prefixLen &&
        arr1[arr1.length - 1 - suffixLen] === arr2[arr2.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const mid1 = arr1.slice(prefixLen, arr1.length - suffixLen);
    const mid2 = arr2.slice(prefixLen, arr2.length - suffixLen);
    const m = mid1.length;
    const n = mid2.length;

    if (m * n > 1000000) {
        throw new Error(`Diff input middle region is too large (${m}x${n} cells exceeds 1,000,000 limit)`);
    }

    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (mid1[i - 1] === mid2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const midLcs = [];
    let i = m, j = n;

    while (i > 0 && j > 0) {
        if (mid1[i - 1] === mid2[j - 1]) {
            midLcs.push(mid1[i - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    midLcs.reverse();

    return [
        ...arr1.slice(0, prefixLen),
        ...midLcs,
        ...arr1.slice(arr1.length - suffixLen)
    ];
}

/**
 * Diff arrays
 */
function canonicalStringify(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (seen.has(value)) {
        return '"[Circular]"';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const out = '[' + value.map(item => canonicalStringify(item, seen)).join(',') + ']';
        seen.delete(value);
        return out;
    }
    const keys = Object.keys(value).sort();
    const entries = keys.map(key => JSON.stringify(key) + ':' + canonicalStringify(value[key], seen));
    seen.delete(value);
    return '{' + entries.join(',') + '}';
}

function diffArray(oldArr, newArr, options = {}) {
    const added = [];
    const removed = [];
    const unchanged = [];

    const oldSet = new Set(oldArr.map(item => canonicalStringify(item)));
    const newSet = new Set(newArr.map(item => canonicalStringify(item)));

    for (const item of oldArr) {
        const serialized = canonicalStringify(item);
        if (newSet.has(serialized)) {
            unchanged.push(item);
        } else {
            removed.push(item);
        }
    }

    for (const item of newArr) {
        const serialized = canonicalStringify(item);
        if (!oldSet.has(serialized)) {
            added.push(item);
        }
    }

    return {
        added,
        removed,
        unchanged,
        summary: {
            added: added.length,
            removed: removed.length,
            unchanged: unchanged.length
        },
        hasChanges: added.length > 0 || removed.length > 0
    };
}
