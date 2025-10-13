# @maitask/pdf-parser

High-performance PDF parser and text extractor.

## Features

- **PDF Text Extraction**: Extract readable text from PDF documents
- **Metadata Extraction**: Title, author, subject, creation date, page count
- **Base64 Support**: Process Base64-encoded PDF files
- **Smart Filtering**: Remove noise and binary artifacts
- **Configurable Output**: Control text length, segment count, and filtering
- **Page Estimation**: Accurate page count detection
- **Error Handling**: Comprehensive error reporting and recovery

## Installation

```bash
npm install @maitask/pdf-parser
```

## Usage

### Basic PDF Parsing

```javascript
// Parse PDF from Base64
const base64Pdf = "JVBERi0xLjQKJcOkw7zDtsOgCjIgMCBvYmo...";
const result = execute({ base64: base64Pdf });

console.log(result.text);
// "This is the extracted text from the PDF document..."

console.log(result.metadata);
// {
//   title: "Document Title",
//   author: "Author Name",
//   estimatedPages: 5,
//   creationDate: "2023-01-15T10:30:00.000Z"
// }
```

### Advanced Configuration

```javascript
const result = execute(
  { base64: pdfData },
  {
    maxSegments: 100,         // Limit text segments
    maxPreviewLength: 5000,   // Limit preview text length
    minSegmentLength: 3,      // Minimum segment length
    excludeShortWords: true,  // Filter out short words
    preserveFormatting: true  // Keep line breaks and structure
  }
);
```

### Text Processing Options

```javascript
const result = execute(
  { base64: pdfData },
  {
    extractImages: true,      // Extract image references
    extractLinks: true,       // Extract URLs and links
    preserveFormatting: false // Clean up formatting
  }
);

console.log(result.segments);
// ["First paragraph text", "Email: user@example.com", "https://example.com"]
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSegments` | number | `200` | Maximum number of text segments to extract |
| `maxPreviewLength` | number | `12000` | Maximum length of preview text |
| `minSegmentLength` | number | `4` | Minimum length for text segments |
| `excludeShortWords` | boolean | `true` | Filter out very short words and abbreviations |
| `preserveFormatting` | boolean | `false` | Preserve line breaks and paragraph structure |
| `extractImages` | boolean | `true` | Extract image references from PDF |
| `extractLinks` | boolean | `true` | Extract URLs and hyperlinks |

## Output Format

```javascript
{
  success: true,
  parser: "pdf",
  fileType: "pdf",
  text: string,              // Main extracted text
  segments: string[],        // Individual text segments
  pages: number,             // Estimated page count
  statistics: {
    totalSegments: number,   // Total segments before filtering
    filteredSegments: number, // Segments after filtering
    estimatedPages: number,  // Page count estimate
    textLength: number,      // Length of extracted text
    hasMetadata: boolean,    // Whether metadata was found
    preview: string[]        // First 5 segments as preview
  },
  metadata: {
    path: string | null,
    size: number | null,
    extension: string,
    encoding: "binary-to-ascii",
    mimeType: "application/pdf",
    title?: string,          // PDF title
    author?: string,         // PDF author
    subject?: string,        // PDF subject
    creator?: string,        // PDF creator application
    producer?: string,       // PDF producer
    creationDate?: string,   // Creation date (ISO 8601)
    modificationDate?: string, // Modification date (ISO 8601)
    estimatedPages: number,  // Page count
    parsedAt: string,        // Parse timestamp
    version: "0.1.0"
  }
}
```

## Error Handling

```javascript
{
  success: false,
  error: {
    message: string,
    code: "PDF_PARSE_ERROR",
    type: "PdfParsingError",
    details: any
  },
  metadata: {
    parsedAt: string,
    version: "0.1.0"
  }
}
```

## Advanced Examples

### Extracting Specific Content

```javascript
const result = execute({ base64: pdfData });

// Check if document has metadata
if (result.statistics.hasMetadata) {
  console.log(`Document: ${result.metadata.title}`);
  console.log(`Author: ${result.metadata.author}`);
  console.log(`Pages: ${result.metadata.estimatedPages}`);
}

// Find email addresses in content
const emails = result.segments.filter(segment =>
  segment.includes('@') && segment.includes('.')
);

// Get document summary
const summary = result.segments.slice(0, 10).join(' ');
```

### Processing Large PDFs

```javascript
// For large PDFs, limit output to improve performance
const result = execute(
  { base64: largePdfData },
  {
    maxSegments: 50,
    maxPreviewLength: 2000,
    excludeShortWords: true
  }
);

console.log(`Processed ${result.statistics.estimatedPages} pages`);
console.log(`Extracted ${result.statistics.filteredSegments} text segments`);
```

### Content Analysis

```javascript
const result = execute({ base64: pdfData });

// Analyze content types
const hasNumbers = result.segments.some(s => /\d/.test(s));
const hasUrls = result.segments.some(s => s.startsWith('http'));
const hasEmails = result.segments.some(s => s.includes('@'));

console.log('Content analysis:', {
  hasNumbers,
  hasUrls,
  hasEmails,
  totalSegments: result.statistics.filteredSegments
});
```

## Supported PDF Features

- **Text Extraction**: Standard PDF text content
- **Metadata**: Document properties and information
- **Page Detection**: Accurate page counting
- **Date Parsing**: PDF date format support
- **Encoding**: ASCII and extended character sets
- **Structure**: Basic text segmentation and filtering

## Limitations

- **Images**: Text within images is not extracted (OCR not included)
- **Complex Layouts**: Tables and complex formatting may not be preserved
- **Encrypted PDFs**: Password-protected files are not supported
- **Fonts**: Embedded fonts may affect text extraction quality

## Performance

- **Memory Efficient**: Streaming-based processing
- **Fast Processing**: Optimized for large documents
- **Configurable Limits**: Control output size and processing time
- **Error Recovery**: Graceful handling of corrupted content

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
- PDF text extraction with metadata
- Base64 input support
- Configurable text processing
- Comprehensive error handling
- Page count estimation
