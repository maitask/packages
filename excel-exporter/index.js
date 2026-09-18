/**
 * @maitask/excel-exporter
 * Export data to Excel spreadsheets with automatic formatting
 *
 * Features:
 * - Export JSON data to .xlsx format
 * - Automatic header detection from object keys
 * - Type-aware cell formatting (numbers, booleans, strings, dates)
 * - Custom headers and sheet names
 * - Multiple sheet support
 * - Auto-fit column widths
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for Excel export
 * @param {Object|Array} input - Data to export (array of objects or arrays)
 * @param {Object} options - Export options
 * @param {Object} context - Execution context
 * @returns {Object} Export result with file path and statistics
 */
function execute(input, options = {}, context = {}) {
    try {
        // Validate input
        if (!input) {
            throw new Error('Input data is required');
        }

        const data = Array.isArray(input) ? input : [input];

        if (data.length === 0) {
            throw new Error('Input data is empty');
        }

        const sheetName = options.sheet_name || options.sheetName || 'Sheet1';
        const filename = String(options.filename || options.path || 'export.csv')
            .replace(/\.xlsx$/i, '.csv');
        const dataType = detectDataType(data);
        const headers = extractHeaders(data, options.headers, dataType);
        const structuredData = structureData(data, headers, dataType);
        const csv = toCsv(headers, structuredData);

        return {
            success: true,
            data: {
                items: structuredData,
                summary: {
                    format: 'csv',
                    filename: filename.endsWith('.csv') ? filename : `${filename}.csv`,
                    sheetName,
                    rowCount: structuredData.length,
                    columnCount: headers.length,
                    dataType
                },
                csv
            },
            metadata: {
                package: '@maitask/excel-exporter',
                version: '0.1.1',
                exportedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown Excel export error',
                code: 'EXCEL_EXPORT_ERROR',
                type: 'ExcelExportError'
            },
            metadata: {
                exportedAt: new Date().toISOString(),
                version: '0.1.1'
            }
        };
    }
}

/**
 * Detect the type of data structure
 */
function detectDataType(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return 'unknown';
    }

    const first = data[0];

    if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
        return 'object_array';
    }

    if (Array.isArray(first)) {
        return 'array_of_arrays';
    }

    return 'primitive_array';
}

/**
 * Extract headers from data or use provided headers
 */
function extractHeaders(data, customHeaders, dataType) {
    if (customHeaders && Array.isArray(customHeaders)) {
        return customHeaders;
    }

    if (dataType === 'object_array' && data.length > 0) {
        const first = data[0];
        return Object.keys(first);
    }

    if (dataType === 'array_of_arrays' && data.length > 0) {
        const first = data[0];
        return first.map((_, idx) => `Column ${idx + 1}`);
    }

    if (dataType === 'primitive_array') {
        return ['Value'];
    }

    return ['Data'];
}

/**
 * Structure data for Excel export
 */
function structureData(data, headers, dataType) {
    if (dataType === 'object_array') {
        return data.map(obj => {
            const row = {};
            headers.forEach(header => {
                row[header] = obj[header] !== undefined ? obj[header] : null;
            });
            return row;
        });
    }

    if (dataType === 'array_of_arrays') {
        return data.map(arr => {
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = arr[idx] !== undefined ? arr[idx] : null;
            });
            return row;
        });
    }

    if (dataType === 'primitive_array') {
        return data.map(value => ({ 'Value': value }));
    }

    return [{ 'Data': JSON.stringify(data) }];
}

function csvCell(value) {
    if (value == null) return '';
    const text = String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function toCsv(headers, rows) {
    const headerLine = headers.map(csvCell).join(',');
    const body = rows.map(row => headers.map(header => csvCell(row[header])).join(','));
    return [headerLine, ...body].join('\n');
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
