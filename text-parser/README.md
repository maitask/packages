# @maitask/text-parser

High-performance text and markdown parser.

## Features

- **Multi-format support**: Plain text, Markdown, log files
- **Encoding support**: UTF-8 and Base64 decoding
- **Content analysis**: Line/word/character statistics
- **Markdown parsing**: Extract headings, links, images, code blocks
- **File type detection**: Automatic detection based on extension/content
- **Error handling**: Comprehensive error reporting

## Execution

Run through Maitask Runtime or invoke the CommonJS entry point locally:

```javascript
const { execute } = require('./index');
```

## Usage

### Basic Text Parsing

```javascript
// Plain text input
const result = execute({ text: "Hello\nWorld!\nThis is a test." });

console.log(result.statistics);
// {
//   totalLines: 3,
//   nonEmptyLines: 3,
//   wordCount: 6,
//   characterCount: 28,
//   avgWordsPerLine: 2
// }
```

### Markdown Parsing

```javascript
// Markdown content
const result = execute({
  text: "# Title\n\n## Section\n\n```js\nconsole.log('hello');\n```",
  extension: "md"
});

console.log(result.data);
// {
//   type: 'markdown',
//   headings: [
//     { level: 1, text: 'Title', line: 1 },
//     { level: 2, text: 'Section', line: 3 }
//   ],
//   codeBlocks: [
//     { language: 'js', content: "console.log('hello');", startLine: 4, endLine: 6 }
//   ]
// }
```

### Base64 Input

```javascript
const base64Text = btoa("Hello World!");
const result = execute({ base64: base64Text });

console.log(result.text); // "Hello World!"
```

## API Reference

### Input Format

```javascript
{
  text?: string,           // Direct text content
  base64?: string,         // Base64 encoded text
  path?: string,           // File path (for metadata)
  extension?: string,      // File extension override
  size?: number           // File size (for metadata)
}
```

### Output Format

```javascript
{
  success: boolean,
  parser: "text",
  fileType: "plaintext" | "markdown" | "log" | "empty",
  text: string,           // Parsed text content
  lines: string[],        // Array of lines
  data: {                 // Structured data
    content: string,
    type: string,
    // For markdown:
    headings?: Array<{level, text, line}>,
    codeBlocks?: Array<{language, content, startLine, endLine}>,
    links?: Array<{text, url, line}>,
    images?: Array<{alt, url, line}>
  },
  statistics: {
    totalLines: number,
    nonEmptyLines: number,
    wordCount: number,
    characterCount: number,
    byteSize: number,
    avgWordsPerLine: number,
    preview: string[]      // First 3 non-empty lines (truncated)
  },
  metadata: {
    path: string | null,
    extension: string | null,
    encoding: "utf-8",
    mimeType: string,
    parsedAt: string,      // ISO timestamp
    version: "0.1.1"
  }
}
```

### Error Format

```javascript
{
  success: false,
  error: {
    message: string,
    code: "PARSE_ERROR",
    type: "TextParsingError"
  },
  metadata: {
    parsedAt: string,
    version: "0.1.1"
  }
}
```

## Supported File Types

| Extension | MIME Type | Features |
|-----------|-----------|----------|
| `.txt`, `.text` | `text/plain` | Basic text analysis |
| `.md`, `.markdown` | `text/markdown` | Markdown structure extraction |
| `.log` | `text/x-log` | Log file parsing |

## Maitask Integration

This package is designed and includes:

- **Parser metadata**: Automatic file type detection
- **Error handling**: Structured error responses
- **Performance**: High-performance processing for large text files
- **Standards compliance**: UTF-8 and Base64 standards

## Requirements

- Node.js >= 18.0.0
