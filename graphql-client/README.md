# @maitask/graphql-client

Execute GraphQL operations against HTTP endpoints.

## Features

- Supports query and mutation payloads
- Pass-through variables and custom headers
- Handles GraphQL `errors` and partial data
- Timeout protection with normalized output

## Input

Required:
- `url`
- `query`

Optional:
- `variables`
- `headers`
- `timeoutMs`

## Example

```json
{
  "url": "https://api.example.com/graphql",
  "query": "query User($id: ID!) { user(id: $id) { id email } }",
  "variables": {
    "id": "42"
  },
  "timeoutMs": 20000
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
