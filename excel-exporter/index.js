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

        // Build configuration
        const config = {
            path: options.path || context.workspace_path + '/output.xlsx',
            sheet_name: options.sheet_name || options.sheetName || 'Sheet1',
            headers: options.headers || null,
            auto_fit: options.auto_fit !== false && options.autoFit !== false
        };

        // Validate output path
        if (!config.path.endsWith('.xlsx')) {
            config.path += '.xlsx';
        }

        // Detect data structure
        const dataType = detectDataType(data);
        const headers = extractHeaders(data, config.headers, dataType);

        // Structure data for export
        const structuredData = structureData(data, headers, dataType);

        // Return export configuration for the engine's Excel adapter
        return {
            success: true,
            exporter: 'excel',
            format: 'xlsx',
            output_adapter: {
                adapter: 'excel',
                config: config,
                data: structuredData
            },
            preview: {
                headers: headers,
                rowCount: structuredData.length,
                sample: structuredData.slice(0, 3)
            },
            statistics: {
                totalRows: structuredData.length,
                totalColumns: headers.length,
                dataType: dataType,
                estimatedSize: estimateFileSize(structuredData, headers)
            },
            metadata: {
                path: config.path,
                sheetName: config.sheet_name,
                hasHeaders: true,
                autoFit: config.auto_fit,
                exportedAt: new Date().toISOString(),
                version: '0.1.0'
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
                version: '0.1.0'
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

/**
 * Estimate file size in bytes
 */
function estimateFileSize(data, headers) {
    const headerSize = headers.reduce((sum, h) => sum + String(h).length, 0);
    const dataSize = data.reduce((sum, row) => {
        return sum + Object.values(row).reduce((s, v) => s + String(v).length, 0);
    }, 0);

    // Excel has overhead, estimate ~3KB base + data
    return 3000 + headerSize * 10 + dataSize * 2;
}

execute;
