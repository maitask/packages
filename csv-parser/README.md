# @maitask/csv-parser

High-performance CSV parser with advanced features and RFC 4180 compliance.

## Features

- **RFC 4180 compliant**: Handles quoted fields, escaped characters, line breaks
- **Advanced configuration**: Custom delimiters, quotes, escape characters
- **Multiple formats**: CSV, TSV, semicolon-separated, pipe-separated
- **Smart headers**: Auto-detection, custom headers, or generated headers
- **Data validation**: Type inference, empty row handling, value trimming
- **Encoding support**: UTF-8 and Base64 decoding
- **Statistics**: Row counts, column analysis, data type detection

## Installation

```bash
npm install @maitask/csv-parser
```

## Usage

### Basic CSV Parsing

```javascript
const csvData = "name,age,city\nJohn,30,New York\nJane,25,Boston";
const result = execute({ text: csvData });

console.log(result.headers);
// ["name", "age", "city"]

console.log(result.rows);
// [
//   { name: "John", age: "30", city: "New York", __row: 1, __sourceRow: 2 },
//   { name: "Jane", age: "25", city: "Boston", __row: 2, __sourceRow: 3 }
// ]
```

### Custom Delimiter (TSV)

```javascript
const tsvData = "name\tage\tcity\nJohn\t30\tNew York";
const result = execute(
  { text: tsvData },
  { delimiter: "\t" }
);
```

### Custom Configuration

```javascript
const result = execute(
  { text: csvData },
  {
    delimiter: ";",           // Semicolon separator
    quote: "'",              // Single quote for escaping
    skipEmpty: false,        // Include empty rows
    trimValues: false,       // Keep whitespace
    headers: ["col1", "col2", "col3"]  // Custom headers
  }
);
```

### Without Headers

```javascript
const result = execute(
  { text: "John,30,New York\nJane,25,Boston" },
  { headers: false }
);

console.log(result.headers);
// ["column_1", "column_2", "column_3"]
```

### Base64 Input

```javascript
const base64Csv = btoa("name,age\nJohn,30");
const result = execute({ base64: base64Csv });
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delimiter` | string | `","` | Column separator character |
| `quote` | string | `"\""` | Quote character for escaping |
| `escape` | string | `"\""` | Escape character (usually same as quote) |
| `skipEmpty` | boolean | `true` | Skip empty rows |
| `trimValues` | boolean | `true` | Trim whitespace from cell values |
| `headers` | boolean\|array | `true` | Use first row as headers, provide custom headers, or disable |

## Output Format

```javascript
{
  success: true,
  parser: "csv",
  format: "csv" | "tsv" | "csv-semicolon" | "csv-pipe",
  headers: string[],           // Column headers
  rows: object[],             // Data rows as objects
  data: object[],             // Alias for rows (compatibility)
  statistics: {
    totalRows: number,         // Number of data rows
    totalColumns: number,      // Number of columns
    sourceRows: number,        // Original rows in file
    skippedRows: number,       // Empty rows skipped
    emptyColumns: number,      // Generated column headers
    dataTypes: {               // Inferred types per column
      "column_name": "string" | "integer" | "number" | "boolean" | "date" | "empty"
    }
  },
  metadata: {
    path: string | null,
    extension: string | null,
    encoding: "utf-8",
    mimeType: string,
    delimiter: string,
    quote: string,
    escape: string,
    hasHeaders: boolean,
    parsedAt: string,          // ISO timestamp
    version: "1.0.0"
  }
}
```

### Row Objects

Each data row includes:

- **Column data**: Values accessible by header names
- **`__row`**: Row number in data (1-based)
- **`__sourceRow`**: Original line number in file (1-based)

## Advanced Examples

### Quoted Fields with Commas

```javascript
const csvData = `name,description
"John Doe","A person who likes apples, oranges"
"Jane Smith","Developer, Designer"`;

const result = execute({ text: csvData });
// Correctly parses quoted fields containing commas
```

### Escaped Quotes

```javascript
const csvData = `name,quote
John,"He said ""Hello World"""
Jane,"She replied ""Goodbye"""`;

const result = execute({ text: csvData });
// Handles doubled quotes as escape sequence
```

### Mixed Data Types

```javascript
const csvData = `name,age,active,date
John,30,true,2023-01-15
Jane,25,false,2023-02-20`;

const result = execute({ text: csvData });

console.log(result.statistics.dataTypes);
// {
//   name: "string",
//   age: "integer",
//   active: "boolean",
//   date: "date"
// }
```

## Error Handling

```javascript
{
  success: false,
  error: {
    message: string,
    code: "CSV_PARSE_ERROR",
    type: "CsvParsingError",
    details: any
  },
  metadata: {
    parsedAt: string,
    version: "1.0.0"
  }
}
```

## Supported Formats

| Format | Extension | Delimiter | MIME Type |
|--------|-----------|-----------|-----------|
| CSV | `.csv` | `,` | `text/csv` |
| TSV | `.tsv` | `\t` | `text/tab-separated-values` |
| Semicolon CSV | `.csv` | `;` | `text/csv` |
| Pipe CSV | `.csv` | `\|` | `text/csv` |

## Performance

- **Memory efficient**: Streaming parser without loading entire file
- **Fast processing**: Optimized for large datasets
- **Type inference**: Automatic data type detection
- **Validation**: Comprehensive error checking

## Standards Compliance

- **RFC 4180**: Full CSV specification compliance
- **UTF-8**: Unicode text support
- **Base64**: Binary data decoding
- **Cross-platform**: Handles various line endings (CRLF, LF, CR)

## Requirements

- Node.js >= 14.0.0
- Maitask Engine >= 1.0.0

## License

MIT © Maitask Team

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add comprehensive tests
4. Submit a pull request

## Changelog

### 0.1.0

- Initial release
- RFC 4180 compliant parsing
- Advanced configuration options
- Type inference and validation
- Multiple format support
- Base64 decoding capability
