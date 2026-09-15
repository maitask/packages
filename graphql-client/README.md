# @maitask/graphql-client

Execute GraphQL operations against HTTPS endpoints.

## Features

- Supports query and mutation payloads
- Optional bearer tokens via `tokenSecret` and Runtime secrets
- Rejects embedded URL credentials
- Handles GraphQL `errors` and partial data
- Timeout protection with normalized output

## Input

Required:
- `url`
- `query`

Optional:
- `variables`
- `headers`
- `tokenSecret`
- `timeoutMs`
- `allowInsecureHttp` (options only; for local fixtures)

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
