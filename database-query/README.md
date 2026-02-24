# @maitask/database-query

Run SQL via HTTP database proxy endpoints.

## Features

- Supports postgresql/mysql/sqlite labels
- Parameter array passthrough
- Optional Basic auth header generation
- Normalized rows/rowCount/fields response

## Input

Required:
- `query`
- `database`
- `host or proxyUrl`

Optional:
- `type`
- `port`
- `username`
- `password`
- `params`
- `timeoutMs`

## Example

```json
{
  "type": "postgresql",
  "host": "db-proxy.internal",
  "port": 5432,
  "database": "analytics",
  "query": "SELECT id, email FROM users WHERE id = $1",
  "params": [
    42
  ],
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
