# @maitask/pdf-parser

Extract Info dictionary metadata and uncompressed `BT`/`ET` text operators from PDF bytes.

This package does not inflate filtered streams and does not decrypt PDFs. Encrypted files fail closed. Compressed page content is counted and skipped.

## Input

Provide PDF bytes as Base64, a binary string, or a byte array:

```json
{
  "base64": "JVBERi0xLjQK..."
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTextLength` | number | `200000` | Maximum extracted text length |

## Result

Successful executions return:

- `data.text` — concatenated uncompressed text operators
- `data.pages` — `/Type /Page` object count
- `data.uncompressedStreams` — streams without `/Filter`
- `data.compressedStreamsSkipped` — filtered streams that were not decoded
- `data.metadata` — Info dictionary fields when present (`title`, `author`, `subject`, `creator`, `producer`, `creationDate`, `modificationDate`)

Encrypted files, missing PDF headers, and empty payloads return `success: false` with a stable error code.
