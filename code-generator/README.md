# @maitask/code-generator

Generate production-oriented code using OpenAI or Claude.

## Features

- Supports OpenAI and Claude providers
- Language-aware system prompt
- Standardized success/error payloads with metadata
- Built-in request timeout handling

## Input

Required:

- `prompt`
- `apiKey`

Optional:

- `provider (openai|claude)`
- `language`
- `model`
- `timeoutMs`

## Example

```json
{
  "prompt": "Write a TypeScript debounce utility with tests.",
  "language": "typescript",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "apiKey": "sk-xxx",
  "timeoutMs": 30000
}
```

## Return Shape

Success:

```json
{
  "success": true,
  "data": {},
  "metadata": {
    "timestamp": "2026-02-24T00:00:00.000Z",
    "version": "0.1.0"
  }
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "message": "error details",
    "code": "PACKAGE_ERROR",
    "type": "PackageError"
  },
  "metadata": {
    "timestamp": "2026-02-24T00:00:00.000Z",
    "version": "0.1.0"
  }
}
```
