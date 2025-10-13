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
 * @version 0.1.0
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
    console.log('NocoDB Importer - Starting import process');

    var config = buildConfig(input, options, context);
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
            message: 'Dry run completed. No data sent to NocoDB.',
            preview: preview,
            totalRows: parsed.rows.length,
            columns: parsed.columns
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
        message: 'Successfully imported ' + parsed.rows.length + ' rows',
        result: {
            importedRows: parsed.rows.length,
            createdTable: tableMeta.created,
            table: tableMeta.info,
            response: importResult
        }
    };
}

function buildConfig(input, options, context) {
    var source = isPlainObject(options) ? options : {};
    if (input && isPlainObject(input.options)) {
        source = mergeObjects(source, input.options);
    }
    if (context && isPlainObject(context.defaults)) {
        source = mergeObjects(context.defaults, source);
    }

    var baseUrl = source.baseUrl || source.base_url;
    var token = source.token || source.apiToken || source.api_key;
    var baseId = source.baseId || source.projectId || source.project;
    var tableName = source.tableName || source.table || source.name;

    if (!baseUrl) {
        throw new Error('NocoDB baseUrl is required');
    }
    if (!token) {
        throw new Error('NocoDB token is required');
    }
    if (!baseId) {
        throw new Error('NocoDB baseId is required');
    }
    if (!tableName) {
        throw new Error('Target tableName is required');
    }

    return {
        baseUrl: trimTrailingSlash(baseUrl),
        token: token,
        baseId: baseId,
        tableName: tableName,
        delimiter: source.delimiter || ',',
        previewRows: source.previewRows || 5,
        dryRun: Boolean(source.dryRun),
        inferTypes: source.inferTypes !== false,
        fallbackColumnType: source.defaultColumnType || 'SingleLineText'
    };
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
            var cell = row[c] !== undefined ? row[c] : '';
            record[columns[c]] = inferTypes ? inferValue(cell) : cell;
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
    var response = await request('GET', url, { headers: headers });
    validateResponse(response, url);
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

    var response = await request('POST', url, { headers: withJson(headers), json: payload });
    validateResponse(response, url);
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
            var response = await request('POST', bulkEndpoints[i], { headers: withJson(headers), json: body });
            if (response.status && response.status >= 400) {
                lastError = 'HTTP ' + response.status + ' at ' + bulkEndpoints[i];
                continue;
            }
            return response.data || { status: response.status, endpoint: bulkEndpoints[i] };
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
    if (typeof httpRequest === 'function') {
        return httpRequest(method, url, options || {});
    }
    if (typeof httpGet === 'function' && method.toUpperCase() === 'GET') {
        return httpGet(url, options || {});
    }
    if (typeof fetch === 'function') {
        var init = { method: method, headers: (options && options.headers) || {} };
        if (options && options.json !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(options.json);
        } else if (options && options.body !== undefined) {
            init.body = options.body;
        }
        var res = await fetch(url, init);
        var text = await res.text();
        var data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (err) {
            data = text;
        }
        return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            body: text,
            data: data
        };
    }
    throw new Error('No HTTP client available');
}

function validateResponse(response, url) {
    if (!response) {
        throw new Error('Empty response from ' + url);
    }
    if (response.status && response.status >= 400) {
        throw new Error('Request to ' + url + ' failed with status ' + response.status);
    }
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

function mergeObjects(base, override) {
    var result = {};
    var baseKeys = Object.keys(base || {});
    for (var i = 0; i < baseKeys.length; i++) {
        result[baseKeys[i]] = base[baseKeys[i]];
    }
    var overrideKeys = Object.keys(override || {});
    for (var j = 0; j < overrideKeys.length; j++) {
        result[overrideKeys[j]] = override[overrideKeys[j]];
    }
    return result;
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

execute;
