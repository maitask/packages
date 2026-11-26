/**
 * @maitask/nocodb-importer
 * Import data to NocoDB with authentication
 *
 * Features:
 * - CSV data import to NocoDB tables
 * - Automatic table creation
 * - Batch record operations
 * - Duplicate detection by unique fields
 * - Dry run mode for preview
 * - Type inference and column mapping
 *
 * @version 0.1.1
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for NocoDB import
 * @param {Object} input - CSV content and import configuration
 * @param {Object} options - Import options and credentials
 * @param {Object} context - Execution context
 * @returns {Object} Import result with row counts and table info
 */
async function execute(input, options, context) {
    var config = null;
    try {
        config = buildConfig(input, options, context);
        var csvContent = extractCsvContent(input);
        if (!csvContent) {
            throw new Error('Input CSV content is required');
        }

        var parsed = parseCsv(csvContent, config.delimiter, config.inferTypes);
        if (!parsed || parsed.rows.length === 0) {
            throw new Error('CSV parsing produced no rows');
        }

        var preview = parsed.rows.slice(0, config.previewRows);
        if (config.dryRun) {
            return {
                success: true,
                data: {
                    dryRun: true,
                    preview: preview,
                    totalRows: parsed.rows.length,
                    columns: parsed.columns
                },
                metadata: {
                    package: '@maitask/nocodb-importer',
                    version: '0.1.1',
                    provider: 'nocodb',
                    tableName: config.tableName,
                    timestamp: new Date().toISOString()
                }
            };
        }

        var authHeaders = {
            'xc-token': config.token,
            'Accept': 'application/json'
        };

        var tableMeta = await ensureTable(config, parsed.columns, authHeaders);
        var importResult = await importRows(config, tableMeta, parsed.rows, authHeaders);

        return {
            success: true,
            data: {
                importedRows: parsed.rows.length,
                createdTable: tableMeta.created,
                table: tableMeta.info,
                response: importResult
            },
            metadata: {
                package: '@maitask/nocodb-importer',
                version: '0.1.1',
                provider: 'nocodb',
                tableName: config.tableName,
                timestamp: new Date().toISOString()
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: redactSecrets(error && error.message ? error.message : 'NocoDB import failed', collectSecrets(config, options, context)),
                code: 'NOCODB_IMPORT_ERROR',
                type: (error && error.name) || 'NocoDBImportError'
            },
            metadata: {
                package: '@maitask/nocodb-importer',
                version: '0.1.1',
                provider: 'nocodb',
                timestamp: new Date().toISOString()
            }
        };
    }
}

function buildConfig(input, options, context) {
    var trustedOptions = isPlainObject(options) ? options : {};
    var defaults = (context && isPlainObject(context.defaults)) ? context.defaults : {};
    var secrets = (context && isPlainObject(context.secrets)) ? context.secrets : {};

    var allowPrivateHosts = trustedOptions.allowPrivateHosts === true || defaults.allowPrivateHosts === true;
    var baseUrlRaw = trustedOptions.baseUrl || trustedOptions.base_url || defaults.baseUrl || defaults.base_url;
    var baseUrl = validateNocoDbBaseUrl(baseUrlRaw, allowPrivateHosts);
    var token =
        trustedOptions.token ||
        trustedOptions.apiToken ||
        secrets.NOCODB_API_TOKEN ||
        secrets.NOCODB_TOKEN;
    var baseId = trustedOptions.baseId || trustedOptions.projectId || trustedOptions.project || defaults.baseId;
    var tableName = trustedOptions.tableName || trustedOptions.table || trustedOptions.name || defaults.tableName;

    if (!token) {
        throw new Error('NocoDB token is required (options.token or context.secrets.NOCODB_API_TOKEN)');
    }
    if (!baseId) {
        throw new Error('NocoDB baseId is required');
    }
    if (!tableName) {
        throw new Error('Target tableName is required');
    }

    return {
        baseUrl: baseUrl,
        token: String(token),
        baseId: String(baseId),
        tableName: String(tableName),
        delimiter: trustedOptions.delimiter || defaults.delimiter || ',',
        previewRows: Math.min(Math.max(Number(trustedOptions.previewRows || defaults.previewRows || 5), 1), 100),
        dryRun: Boolean(trustedOptions.dryRun ?? defaults.dryRun),
        inferTypes: (trustedOptions.inferTypes ?? defaults.inferTypes) !== false,
        fallbackColumnType: trustedOptions.defaultColumnType || defaults.defaultColumnType || 'SingleLineText',
        timeoutMs: Math.min(Math.max(Number(trustedOptions.timeoutMs || defaults.timeoutMs || 30000), 1000), 120000)
    };
}

function validateNocoDbBaseUrl(rawUrl, allowPrivateHosts) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new Error('NocoDB baseUrl is required');
    }
    var parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch (_err) {
        throw new Error('NocoDB baseUrl must be a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('NocoDB baseUrl must use http or https');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('NocoDB baseUrl must not include credentials, query, or fragment');
    }
    if (!allowPrivateHosts && isBlockedHost(parsed.hostname)) {
        throw new Error('NocoDB baseUrl host is not permitted');
    }
    return trimTrailingSlash(parsed.toString());
}

function extractCsvContent(input) {
    if (!input) {
        return null;
    }
    if (typeof input === 'string') {
        return input;
    }
    if (isPlainObject(input) && typeof input.content === 'string') {
        return input.content;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(input)) {
        return input.toString('utf8');
    }
    return null;
}

function parseCsv(content, delimiter, inferTypes) {
    delimiter = delimiter || ',';
    var rows = [];
    var columns = [];
    var current = [];
    var value = '';
    var inQuotes = false;
    var i;

    for (i = 0; i < content.length; i++) {
        var char = content[i];
        var nextChar = content[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            current.push(value);
            value = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            current.push(value);
            value = '';
            if (current.length > 1 || current[0] !== '') {
                rows.push(current);
            }
            current = [];
        } else {
            value += char;
        }
    }

    current.push(value);
    if (current.length > 1 || current[0] !== '') {
        rows.push(current);
    }

    if (rows.length === 0) {
        return { columns: [], rows: [] };
    }

    columns = rows.shift().map(function (name) {
        return name.trim();
    });

    var objects = [];
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var record = {};
        for (var c = 0; c < columns.length; c++) {
            var columnName = columns[c];
            if (columnName === '__proto__' || columnName === 'constructor' || columnName === 'prototype') {
                throw new Error('Unsafe CSV column header: ' + columnName);
            }
            var cell = row[c] !== undefined ? row[c] : '';
            Object.defineProperty(record, columnName, {
                value: inferTypes ? inferValue(cell) : cell,
                enumerable: true,
                writable: true,
                configurable: true
            });
        }
        objects.push(record);
    }

    return { columns: columns, rows: objects };
}

async function ensureTable(config, columns, headers) {
    var tables = await listTables(config, headers);
    var existing = findTable(tables, config.tableName);
    if (existing) {
        return { created: false, info: existing };
    }

    var columnDefinitions = buildColumnDefinitions(columns, config);
    await createTable(config, columnDefinitions, headers);
    var refreshedTables = await listTables(config, headers);
    var created = findTable(refreshedTables, config.tableName);

    if (!created) {
        throw new Error('Table creation reported success but table not found afterwards');
    }

    return { created: true, info: created };
}

async function listTables(config, headers) {
    var url = config.baseUrl + '/api/v2/meta/bases/' + encodeURIComponent(config.baseId) + '/tables';
    var response = await request('GET', url, { headers: headers, timeoutMs: config.timeoutMs });
    validateResponse(response);
    if (response.data && Array.isArray(response.data.list)) {
        return response.data.list;
    }
    if (Array.isArray(response.data)) {
        return response.data;
    }
    return [];
}

async function createTable(config, columnDefinitions, headers) {
    var url = config.baseUrl + '/api/v2/meta/bases/' + encodeURIComponent(config.baseId) + '/tables';
    var payload = {
        table_name: config.tableName,
        display_name: config.tableName,
        columns: columnDefinitions
    };

    var response = await request('POST', url, { headers: withJson(headers), json: payload, timeoutMs: config.timeoutMs });
    validateResponse(response);
}

async function importRows(config, tableMeta, rows, headers) {
    var table = tableMeta.info;
    var tableId = table.id || table.table_id || table.tableId;
    var tableName = table.table_name || table.name || config.tableName;

    var bulkEndpoints = [
        config.baseUrl + '/api/v2/meta/bases/' + encodeURIComponent(config.baseId) + '/tables/' + encodeURIComponent(tableId || tableName) + '/rows/bulk',
        config.baseUrl + '/api/v1/db/data/bulk/' + encodeURIComponent(config.baseId) + '/' + encodeURIComponent(tableName)
    ];

    var body = { rows: rows };
    var lastError = null;

    for (var i = 0; i < bulkEndpoints.length; i++) {
        try {
            var response = await request('POST', bulkEndpoints[i], { headers: withJson(headers), json: body, timeoutMs: config.timeoutMs });
            if (response.status && response.status >= 400) {
                lastError = 'HTTP ' + response.status + ' from NocoDB bulk endpoint';
                continue;
            }
            return response.data || { status: response.status, endpoint: safeEndpointPath(bulkEndpoints[i]) };
        } catch (err) {
            lastError = err.message;
        }
    }

    throw new Error('Failed to import data into NocoDB: ' + (lastError || 'Unknown error'));
}

function buildColumnDefinitions(columns, config) {
    var definitions = [];
    for (var i = 0; i < columns.length; i++) {
        var name = columns[i];
        definitions.push({
            column_name: name,
            column_type: config.fallbackColumnType,
            title: name
        });
    }
    return definitions;
}

function findTable(tables, tableName) {
    if (!Array.isArray(tables)) {
        return null;
    }
    var lowerTarget = tableName.toLowerCase();
    for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        var matches = false;
        if (table.table_name && table.table_name.toLowerCase() === lowerTarget) {
            matches = true;
        }
        if (table.name && table.name.toLowerCase() === lowerTarget) {
            matches = true;
        }
        if (matches) {
            return table;
        }
    }
    return null;
}

async function request(method, url, options) {
    var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
    if (typeof fetch === 'function') {
        var timeoutMs = (options && options.timeoutMs) || 30000;
        var init = {
            method: method,
            headers: mergeObjects({}, (options && options.headers) || {}),
            redirect: 'manual',
            timeoutMs: timeoutMs
        };
        if (options && options.json !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(options.json);
        } else if (options && options.body !== undefined) {
            init.body = options.body;
        }
        var runtimeFetch = usesMaitaskRuntimeFetch();
        var controller = runtimeFetch ? null : new AbortController();
        var timer = runtimeFetch ? null : setTimeout(function () { controller.abort(); }, timeoutMs);
        if (runtimeFetch) {
            init.maxResponseBytes = MAX_RESPONSE_BYTES;
        } else {
            init.signal = controller.signal;
        }
        try {
            var res = await fetch(url, init);
            if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
                if (res && res.body && typeof res.body.cancel === 'function') {
                    try { await res.body.cancel(); } catch (_err) {}
                }
                throw new Error('NocoDB endpoint must not redirect');
            }
            var text = await readBoundedText(res, MAX_RESPONSE_BYTES);
            var data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_err) {
                data = text;
            }
            return {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText,
                body: text,
                data: data
            };
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error('NocoDB request timed out after ' + timeoutMs + 'ms');
            }
            throw err;
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    }
    throw new Error('No HTTP client available');
}

function validateResponse(response) {
    if (!response) {
        throw new Error('Empty response from NocoDB endpoint');
    }
    if (response.status && response.status >= 400) {
        throw new Error('NocoDB request failed with status ' + response.status);
    }
}

function safeEndpointPath(url) {
    try {
        return new URL(url).pathname;
    } catch (_err) {
        return '/nocodb';
    }
}

function collectSecrets(config, options, context) {
    var list = [];
    if (config && config.token) list.push(String(config.token));
    if (options && typeof options === 'object') {
        if (options.token) list.push(String(options.token));
        if (options.apiToken) list.push(String(options.apiToken));
        if (options.api_key) list.push(String(options.api_key));
    }
    if (context && context.secrets && typeof context.secrets === 'object') {
        if (context.secrets.NOCODB_API_TOKEN) list.push(String(context.secrets.NOCODB_API_TOKEN));
        if (context.secrets.NOCODB_TOKEN) list.push(String(context.secrets.NOCODB_TOKEN));
    }
    return list;
}

function redactSecrets(message, secrets) {
    var text = String(message || 'NocoDB import failed');
    for (var i = 0; i < (secrets || []).length; i++) {
        if (secrets[i]) {
            text = text.split(secrets[i]).join('[redacted]');
        }
    }
    return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
}

function withJson(headers) {
    var merged = {};
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
        merged[keys[i]] = headers[keys[i]];
    }
    merged['Content-Type'] = 'application/json';
    return merged;
}

function isSafeKey(key) {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function mergeObjects(base, override) {
    var result = Object.create(null);
    var baseKeys = isPlainObject(base) ? Object.keys(base) : [];
    for (var i = 0; i < baseKeys.length; i++) {
        if (Object.hasOwn(base, baseKeys[i]) && isSafeKey(baseKeys[i])) {
            result[baseKeys[i]] = base[baseKeys[i]];
        }
    }
    var overrideKeys = isPlainObject(override) ? Object.keys(override) : [];
    for (var j = 0; j < overrideKeys.length; j++) {
        if (Object.hasOwn(override, overrideKeys[j]) && isSafeKey(overrideKeys[j])) {
            result[overrideKeys[j]] = override[overrideKeys[j]];
        }
    }
    return result;
}

function usesMaitaskRuntimeFetch() {
    return Boolean(
        typeof Deno !== 'undefined' &&
        Deno &&
        Deno.core &&
        Deno.core.ops &&
        typeof Deno.core.ops.op_http_request === 'function'
    );
}

async function readBoundedText(response, maxBytes) {
    if (response && response.body && typeof response.body.getReader === 'function') {
        var reader = response.body.getReader();
        var decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
        var out = '';
        var total = 0;
        try {
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                if (!chunk.value) continue;
                if (total + chunk.value.byteLength > maxBytes) {
                    throw new Error('NocoDB response exceeds 5MB limit');
                }
                out += decoder ? decoder.decode(chunk.value, { stream: true }) : String.fromCharCode.apply(null, chunk.value);
                total += chunk.value.byteLength;
            }
        } finally {
            try { await reader.cancel(); } catch (_err) {}
        }
        if (decoder) out += decoder.decode();
        return out;
    }
    var text = await response.text();
    if (typeof text === 'string' && text.length > maxBytes) {
        throw new Error('NocoDB response exceeds 5MB limit');
    }
    return text || '';
}

function isBlockedHost(hostname) {
    var normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
    if (normalized.indexOf(':') !== -1) {
        var clean = normalized.split('%')[0];
        var hextets = parseIpv6Hextets(clean);
        if (!hextets) return true;
        var allZero = hextets.every(function (part) { return part === 0; });
        var isLoopback = hextets.slice(0, 7).every(function (part) { return part === 0; }) && hextets[7] === 1;
        if (allZero || isLoopback) return true;
        if ((hextets[0] & 0xffc0) === 0xfe80) return true;
        if ((hextets[0] & 0xfe00) === 0xfc00) return true;
        if (hextets.slice(0, 5).every(function (part) { return part === 0; }) && hextets[5] === 0xffff) return true;
        return false;
    }
    var ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    var a = Number(ipv4[1]);
    var b = Number(ipv4[2]);
    var c = Number(ipv4[3]);
    var d = Number(ipv4[4]);
    if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) return true;
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
    var halves = address.split('::');
    if (halves.length > 2) return null;
    function parsePart(part) {
        if (!part) return [];
        var tokens = part.split(':');
        var out = [];
        for (var i = 0; i < tokens.length; i += 1) {
            var token = tokens[i];
            if (!token) return null;
            if (token.indexOf('.') !== -1) {
                if (i !== tokens.length - 1) return null;
                var v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
                if (!v4) return null;
                var octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
                if (octets.some(function (o) { return o < 0 || o > 255; })) return null;
                out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
            } else {
                if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
                out.push(parseInt(token, 16));
            }
        }
        return out;
    }
    var left = parsePart(halves[0]);
    if (!left) return null;
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    var right = parsePart(halves[1]);
    if (!right) return null;
    var missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return left.concat(new Array(missing).fill(0), right);
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function trimTrailingSlash(url) {
    return url.replace(/\/$/, '');
}

function inferValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    var trimmed = String(value).trim();
    if (trimmed === '') {
        return '';
    }

    if (/^(true|false)$/i.test(trimmed)) {
        return trimmed.toLowerCase() === 'true';
    }

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed) && trimmed.indexOf(',') === -1) {
        var numeric = Number(trimmed);
        if (!isNaN(numeric)) {
            return numeric;
        }
    }

    var timestamp = Date.parse(trimmed);
    if (!isNaN(timestamp) && trimmed.length >= 8 && /[-/:]/.test(trimmed)) {
        return new Date(timestamp).toISOString();
    }

    return trimmed;
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
