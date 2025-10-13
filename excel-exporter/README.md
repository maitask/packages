# @maitask/excel-exporter

Export data to Excel spreadsheets (.xlsx) with automatic formatting and type detection.

## Features

- **Automatic Structure Detection**: Handles arrays of objects, arrays of arrays, or primitive values
- **Type-Aware Formatting**: Numbers, booleans, strings, and dates formatted correctly
- **Custom Headers**: Use custom column headers or auto-detect from object keys
- **Auto-Fit Columns**: Automatically adjust column widths
- **Sheet Configuration**: Custom sheet names and multiple sheets support
- **Production Ready**: Optimized for performance and reliability

## Installation

```bash
maitask install @maitask/excel-exporter
```

## Usage

### Basic Export

```bash
# Export array of objects
echo '[{"name":"John","age":30},{"name":"Jane","age":25}]' | maitask run @maitask/excel-exporter --config '{"path":"./output.xlsx"}'

# Export from file
maitask run @maitask/excel-exporter --input data.json --config '{"path":"./report.xlsx","sheet_name":"Sales"}'
```

### API Usage

```bash
curl -X POST http://localhost:8080/packages/@maitask/excel-exporter/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {"product": "Widget A", "quantity": 100, "price": 29.99},
      {"product": "Widget B", "quantity": 50, "price": 45.50}
    ],
    "options": {
      "path": "./sales_report.xlsx",
      "sheet_name": "Q4_Sales",
      "auto_fit": true
    }
  }'
```

## Input Format

### Array of Objects (Recommended)

```json
[
  {"id": 1, "name": "Product A", "price": 29.99, "in_stock": true},
  {"id": 2, "name": "Product B", "price": 45.50, "in_stock": false}
]
```

### Array of Arrays

```json
[
  [1, "Product A", 29.99, true],
  [2, "Product B", 45.50, false]
]
```

### Primitive Array

```json
[100, 200, 300, 400]
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | `./output.xlsx` | Output file path (.xlsx extension auto-added) |
| `sheet_name` | string | `Sheet1` | Worksheet name |
| `headers` | array | Auto-detected | Custom column headers |
| `auto_fit` | boolean | `true` | Auto-fit column widths |

## Output Format

```json
{
  "success": true,
  "exporter": "excel",
  "format": "xlsx",
  "output_adapter": {
    "adapter": "excel",
    "config": {...},
    "data": [...]
  },
  "preview": {
    "headers": ["id", "name", "price", "in_stock"],
    "rowCount": 2,
    "sample": [...]
  },
  "statistics": {
    "totalRows": 2,
    "totalColumns": 4,
    "dataType": "object_array",
    "estimatedSize": 5234
  },
  "metadata": {
    "path": "./output.xlsx",
    "sheetName": "Sheet1",
    "hasHeaders": true,
    "autoFit": true,
    "exportedAt": "2025-09-30T14:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Examples

### Sales Report

```javascript
{
  "input": [
    {"date": "2025-Q1", "region": "North", "revenue": 125000, "growth": 15.5},
    {"date": "2025-Q1", "region": "South", "revenue": 98000, "growth": 8.2},
    {"date": "2025-Q1", "region": "East", "revenue": 156000, "growth": 22.1}
  ],
  "options": {
    "path": "./reports/sales_q1.xlsx",
    "sheet_name": "Q1_Results",
    "auto_fit": true
  }
}
```

### Inventory Export with Custom Headers

```javascript
{
  "input": [
    [101, "Widget A", 29.99, 150],
    [102, "Widget B", 45.50, 75],
    [103, "Widget C", 15.25, 200]
  ],
  "options": {
    "path": "./inventory.xlsx",
    "headers": ["SKU", "Product Name", "Price", "Quantity"],
    "sheet_name": "Current_Inventory"
  }
}
```

## Performance

- **Small datasets** (< 1000 rows): < 50ms
- **Medium datasets** (1000-10000 rows): 100-500ms
- **Large datasets** (> 10000 rows): 1-3 seconds

File size estimates:

- 100 rows: ~5 KB
- 1000 rows: ~30 KB
- 10000 rows: ~250 KB

## Error Handling

```json
{
  "success": false,
  "error": {
    "message": "Input data is empty",
    "code": "EXCEL_EXPORT_ERROR",
    "type": "ExcelExportError"
  },
  "metadata": {
    "exportedAt": "2025-09-30T14:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Integration with Adapters

This package uses the engine's Excel adapter. The output includes `output_adapter` configuration that the engine automatically processes.

```javascript
// The package returns this structure
{
  "output_adapter": {
    "adapter": "excel",
    "config": { "path": "./output.xlsx", ... },
    "data": [...]
  }
}

// The engine automatically sends data to the Excel adapter
```

## Use Cases

- **Report Generation**: Export analytics and metrics to Excel
- **Data Export**: Convert JSON/CSV data to Excel format
- **Dashboard Exports**: Save dashboard data for offline analysis
- **Batch Processing**: Process large datasets and export results
- **ETL Pipelines**: Transform and export data to Excel

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/maitask/packages/issues)
- **Documentation**: [Maitask Docs](https://docs.maitask.com)
- **Community**: [Discord](https://discord.gg/maitask)
