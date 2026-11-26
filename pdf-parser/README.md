# @maitask/pdf-parser

Extract Info dictionary metadata and text operators from uncompressed and FlateDecode-compressed PDF streams.

Encrypted PDFs fail closed without decrypting. Streams using unsupported compression filters are counted in `data.compressedStreamsSkipped`.

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

- `data.text` — concatenated extracted text operators
- `data.pages` — `/Type /Page` object count
- `data.uncompressedStreams` — streams without `/Filter`
- `data.decompressedStreams` — `FlateDecode` streams decoded and extracted
- `data.compressedStreamsSkipped` — filtered streams using unsupported codecs that were not decoded
- `data.metadata` — Info dictionary fields when present (`title`, `author`, `subject`, `creator`, `producer`, `creationDate`, `modificationDate`)

Encrypted files, missing PDF headers, and empty payloads return `success: false` with a stable error code.
