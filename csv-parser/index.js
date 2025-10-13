/**
 * @maitask/csv-parser
 * High-performance CSV parser with advanced features
 *
 * Features:
 * - RFC 4180 compliant CSV parsing
 * - Custom delimiters, quotes, and escape characters
 * - Header detection and custom headers
 * - Data validation and type inference
 * - UTF-8 and Base64 support
 * - Empty row handling
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/**
 * Main execution function for CSV parsing
 * @param {Object} input - Input data with text or base64 content
 * @param {Object} options - Parsing options
 * @param {Object} context - Execution context
 * @returns {Object} Parsed CSV data with validation
 */
function execute(input, options = {}, context = {}) {
    try {
        const config = buildParsingConfig(options, input);
        const text = ensureTextPayload(input);

        if (!text) {
            return createEmptyResponse(input, config);
        }

        const normalized = normalizeNewlines(text);
        const rawRows = parseCsvContent(normalized, config);

        if (!rawRows.length) {
            return createEmptyResponse(input, config);
        }

        const { headers, dataRows } = processRowsAndHeaders(rawRows, config);
        const validatedData = validateAndTransformData(dataRows, headers, config);

        return {
            success: true,
            parser: 'csv',
            format: detectFormat(config.delimiter),
            headers,
            rows: validatedData.rows,
            data: validatedData.rows, // Alias for compatibility
            statistics: {
                totalRows: validatedData.rows.length,
                totalColumns: headers.length,
                sourceRows: rawRows.length,
                skippedRows: rawRows.length - validatedData.rows.length - (config.headers === true ? 1 : 0),
                emptyColumns: headers.filter(h => h.startsWith('column_')).length,
                dataTypes: inferColumnTypes(validatedData.rows, headers)
            },
            metadata: {
                path: input?.path || null,
                size: input?.size || null,
                extension: input?.extension || detectExtension(input?.path),
                encoding: 'utf-8',
                mimeType: getMimeType(config.delimiter),
                delimiter: config.delimiter,
                quote: config.quote,
                escape: config.escape,
                hasHeaders: config.headers !== false,
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown CSV parsing error',
                code: 'CSV_PARSE_ERROR',
                type: 'CsvParsingError',
                details: error.details || null
            },
            metadata: {
                parsedAt: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

execute;

/**
 * Build parsing configuration from options and input
 */
function buildParsingConfig(options, input) {
    const extension = (input?.extension || detectExtension(input?.path) || '').toLowerCase();

    return {
        delimiter: options.delimiter || (extension === 'tsv' ? '\t' : ','),
        quote: options.quote || '"',
        escape: options.escape || options.quote || '"',
        skipEmpty: options.skipEmpty !== false,
        trimValues: options.trimValues !== false,
        headers: options.headers !== false ? (Array.isArray(options.headers) ? options.headers : true) : false
    };
}

/**
 * Detect CSV format type
 */
function detectFormat(delimiter) {
    switch (delimiter) {
        case '\t': return 'tsv';
        case ';': return 'csv-semicolon';
        case '|': return 'csv-pipe';
        default: return 'csv';
    }
}

/**
 * Get MIME type for delimiter
 */
function getMimeType(delimiter) {
    return delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv';
}

/**
 * Extract extension from file path
 */
function detectExtension(path) {
    if (!path || typeof path !== 'string') return null;
    const match = path.match(/\.([^.]+)$/);
    return match ? match[1] : null;
}

/**
 * Create empty response for no data
 */
function createEmptyResponse(input, config) {
    return {
        success: true,
        parser: 'csv',
        format: detectFormat(config.delimiter),
        headers: [],
        rows: [],
        data: [],
        statistics: {
            totalRows: 0,
            totalColumns: 0,
            sourceRows: 0,
            skippedRows: 0,
            emptyColumns: 0,
            dataTypes: {}
        },
        metadata: {
            path: input?.path || null,
            extension: input?.extension || detectExtension(input?.path),
            encoding: 'utf-8',
            mimeType: getMimeType(config.delimiter),
            delimiter: config.delimiter,
            hasHeaders: config.headers !== false,
            parsedAt: new Date().toISOString(),
            version: '1.0.0'
        }
    };
}

/**
 * Process rows and extract/generate headers
 */
function processRowsAndHeaders(rawRows, config) {
    let headers;
    let dataRows;

    if (Array.isArray(config.headers)) {
        // Custom headers provided
        headers = config.headers.slice();
        dataRows = rawRows;
    } else if (config.headers === true && rawRows.length > 0) {
        // Use first row as headers
        const headerRow = rawRows[0];
        headers = headerRow.map((header, index) => {
            const cleaned = header && typeof header === 'string' ? header.trim() : '';
            return cleaned || `column_${index + 1}`;
        });
        dataRows = rawRows.slice(1);
    } else {
        // Generate numeric headers
        const maxColumns = Math.max(...rawRows.map(row => row.length));
        headers = Array.from({ length: maxColumns }, (_, i) => `column_${i + 1}`);
        dataRows = rawRows;
    }

    return { headers, dataRows };
}

/**
 * Validate and transform data rows
 */
function validateAndTransformData(dataRows, headers, config) {
    const processedRows = [];

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const row = dataRows[rowIndex];

        // Skip empty rows if configured
        if (config.skipEmpty && isEmptyRow(row)) {
            continue;
        }

        const record = {};

        // Process each column
        for (let colIndex = 0; colIndex < headers.length; colIndex++) {
            const header = headers[colIndex];
            let value = row[colIndex];

            // Handle missing values
            if (value === undefined || value === null) {
                value = '';
            } else if (typeof value === 'string' && config.trimValues) {
                value = value.trim();
            }

            record[header] = value;
        }

        // Add row metadata
        record.__row = rowIndex + 1;
        record.__sourceRow = rowIndex + (config.headers === true ? 2 : 1);

        processedRows.push(record);
    }

    return { rows: processedRows };
}

/**
 * Check if row is empty
 */
function isEmptyRow(row) {
    return !row || row.every(cell => !cell || (typeof cell === 'string' && cell.trim() === ''));
}

/**
 * Infer data types for columns
 */
function inferColumnTypes(rows, headers) {
    const types = {};

    for (const header of headers) {
        const values = rows.map(row => row[header]).filter(v => v !== '' && v != null);

        if (values.length === 0) {
            types[header] = 'empty';
        } else if (values.every(v => /^\d+$/.test(v))) {
            types[header] = 'integer';
        } else if (values.every(v => /^\d*\.?\d+$/.test(v))) {
            types[header] = 'number';
        } else if (values.every(v => /^(true|false)$/i.test(v))) {
            types[header] = 'boolean';
        } else if (values.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) {
            types[header] = 'date';
        } else {
            types[header] = 'string';
        }
    }

    return types;
}

/**
 * Parse CSV content with advanced options
 */
function parseCsvContent(text, config) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];

        // Handle quotes
        if (char === config.quote) {
            if (inQuotes) {
                if (nextChar === config.quote) {
                    // Escaped quote
                    currentCell += config.quote;
                    i += 2;
                    continue;
                } else if (nextChar === config.escape && config.escape !== config.quote) {
                    // Escaped character
                    currentCell += nextChar;
                    i += 2;
                    continue;
                } else {
                    // End quote
                    inQuotes = false;
                    i++;
                    continue;
                }
            } else {
                // Start quote
                inQuotes = true;
                i++;
                continue;
            }
        }

        // Handle escape characters (when different from quote)
        if (char === config.escape && config.escape !== config.quote && inQuotes) {
            if (nextChar) {
                currentCell += nextChar;
                i += 2;
                continue;
            }
        }

        // Handle delimiters
        if (char === config.delimiter && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
            i++;
            continue;
        }

        // Handle line breaks
        if ((char === '\n' || char === '\r') && !inQuotes) {
            // Handle CRLF
            if (char === '\r' && nextChar === '\n') {
                i++;
            }

            currentRow.push(currentCell);

            if (!config.skipEmpty || !isEmptyRow(currentRow)) {
                rows.push(currentRow);
            }

            currentRow = [];
            currentCell = '';
            i++;
            continue;
        }

        // Regular character
        currentCell += char;
        i++;
    }

    // Handle final row
    currentRow.push(currentCell);
    if (!config.skipEmpty || !isEmptyRow(currentRow)) {
        rows.push(currentRow);
    }

    return rows;
}

/**
 * Normalize line endings
 */
function normalizeNewlines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Extract text content from input payload
 */
function ensureTextPayload(input) {
    if (!input) {
        return '';
    }

    // Direct text property
    if (typeof input.text === 'string') {
        return input.text;
    }

    // Base64 encoded content
    if (typeof input.base64 === 'string' && input.base64.length > 0) {
        return decodeBase64ToUtf8(input.base64);
    }

    // Handle string input directly
    if (typeof input === 'string') {
        return input;
    }

    return '';
}

/**
 * Decode Base64 to UTF-8 text
 */
function decodeBase64ToUtf8(base64) {
    try {
        const bytes = decodeBase64ToBytes(base64);
        return bytesToUtf8(bytes);
    } catch (error) {
        throw new Error(`Base64 decoding failed: ${error.message}`);
    }
}

/**
 * Decode Base64 string to byte array
 */
function decodeBase64ToBytes(base64) {
    const clean = String(base64).replace(/[^A-Za-z0-9+/=]/g, '');

    if (clean.length % 4 !== 0) {
        throw new Error('Invalid Base64 string length');
    }

    const bytes = [];

    for (let i = 0; i < clean.length; i += 4) {
        const enc1 = BASE64_ALPHABET.indexOf(clean[i]);
        const enc2 = BASE64_ALPHABET.indexOf(clean[i + 1]);
        const enc3 = BASE64_ALPHABET.indexOf(clean[i + 2]);
        const enc4 = BASE64_ALPHABET.indexOf(clean[i + 3]);

        if (enc1 < 0 || enc2 < 0) {
            throw new Error('Invalid Base64 character');
        }

        const chr1 = (enc1 << 2) | (enc2 >> 4);
        const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        const chr3 = ((enc3 & 3) << 6) | enc4;

        bytes.push(chr1 & 255);
        if (enc3 !== 64) {
            bytes.push(chr2 & 255);
        }
        if (enc4 !== 64) {
            bytes.push(chr3 & 255);
        }
    }

    return bytes;
}

/**
 * Convert byte array to UTF-8 string
 */
function bytesToUtf8(bytes) {
    let result = '';
    let i = 0;

    while (i < bytes.length) {
        const byte1 = bytes[i++];

        if (byte1 < 0x80) {
            // Single-byte character (ASCII)
            result += String.fromCharCode(byte1);
        } else if (byte1 >= 0xC0 && byte1 < 0xE0 && i < bytes.length) {
            // Two-byte character
            const byte2 = bytes[i++];
            result += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        } else if (byte1 >= 0xE0 && byte1 < 0xF0 && i + 1 < bytes.length) {
            // Three-byte character
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            result += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        } else if (byte1 >= 0xF0 && i + 2 < bytes.length) {
            // Four-byte character (surrogate pair)
            const byte2 = bytes[i++];
            const byte3 = bytes[i++];
            const byte4 = bytes[i++];
            const codePoint = ((byte1 & 0x07) << 18) |
                ((byte2 & 0x3F) << 12) |
                ((byte3 & 0x3F) << 6) |
                (byte4 & 0x3F);

            if (codePoint > 0x10000) {
                const offset = codePoint - 0x10000;
                result += String.fromCharCode((offset >> 10) + 0xD800, (offset & 0x3FF) + 0xDC00);
            } else {
                result += String.fromCharCode(codePoint);
            }
        } else {
            // Invalid UTF-8 sequence, skip
            continue;
        }
    }

    return result;
}
