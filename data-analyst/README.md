# @maitask/data-analyst

Analyze structured or unstructured data with LLM providers.

## Features

- Task modes: analyze, summarize, trends
- Supports OpenAI and Claude
- Consistent error handling and metadata
- Timeout-protected upstream calls

## Input

Required:
- `data`
- `apiKey`

Optional:
- `task (analyze|summarize|trends)`
- `provider`
- `model`
- `timeoutMs`

## Example

```json
{
  "data": [
    {
      "revenue": 120,
      "month": "2026-01"
    },
    {
      "revenue": 136,
      "month": "2026-02"
    }
  ],
  "task": "trends",
  "provider": "claude",
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
