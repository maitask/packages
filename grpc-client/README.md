# @maitask/grpc-client

Invoke gRPC services through HTTP transcoding gateways.

## Features

- Targets `/{service}/{method}` style transcoded routes
- Custom headers and body payload support
- Unified result metadata
- Timeout-protected network calls

## Input

Required:
- `host`
- `service`
- `method`

Optional:
- `port`
- `body`
- `headers`
- `timeoutMs`

## Example

```json
{
  "host": "grpc-gateway.internal",
  "port": 8080,
  "service": "user.v1.UserService",
  "method": "GetUser",
  "body": {
    "id": "42"
  }
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
