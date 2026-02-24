# @maitask/redis-cache

Execute Redis cache operations via HTTP proxy.

## Features

- Operations: get/set/delete/expire/exists
- Proxy endpoint or host/port fallback
- TTL support for set operations
- Unified result and metadata output

## Input

Required:
- `operation`
- `key`

Optional:
- `value`
- `ttl`
- `proxyUrl`
- `host`
- `port`
- `headers`
- `timeoutMs`

## Example

```json
{
  "operation": "set",
  "key": "session:user:42",
  "value": {
    "role": "admin"
  },
  "ttl": 3600,
  "proxyUrl": "https://redis-proxy.internal/redis"
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
