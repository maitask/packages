# @maitask/document-qa

Answer questions strictly from provided document content.

## Features

- Provider support for OpenAI and Claude
- Prompt constrained to document context
- Standardized metadata and error model
- Configurable timeout and model

## Input

Required:
- `document`
- `question`
- `apiKey`

Optional:
- `provider`
- `model`
- `timeoutMs`

## Example

```json
{
  "document": "SLA: P1 incident response <= 15 minutes.",
  "question": "What is the P1 response target?",
  "provider": "openai",
  "apiKey": "sk-xxx"
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
