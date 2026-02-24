# @maitask/http-client

General-purpose HTTP client with retry and auth helpers.

## Features

- Supports bearer/basic/apikey auth
- Retries with exponential backoff
- Response body auto JSON parse fallback
- Standardized metadata and errors

## Input

Required:
- `url`

Optional:
- `method`
- `headers`
- `body`
- `auth`
- `retries`
- `timeoutMs`

## Example

```json
{
  "url": "https://api.example.com/v1/items",
  "method": "POST",
  "headers": {
    "X-Trace-Id": "trace-123"
  },
  "body": {
    "name": "demo"
  },
  "auth": {
    "type": "bearer",
    "token": "token-xxx"
  },
  "retries": 2,
  "timeoutMs": 15000
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
