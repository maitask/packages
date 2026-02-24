# @maitask/s3-storage

Work with S3-compatible storage through proxy APIs or presigned URLs.

## Features

- Operations: list/upload/download/delete
- Supports presigned URL mode for object operations
- Supports proxy mode for centralized credentials
- Consistent metadata and timeout handling

## Input

Required:

- `operation`
- `bucket (for proxy mode) or presignedUrl (for object ops)`

Optional:

- `proxyUrl`
- `key`
- `body`
- `headers`
- `region`
- `endpoint`
- `timeoutMs`

## Example

```json
{
  "operation": "upload",
  "presignedUrl": "https://bucket.s3.amazonaws.com/path/file.txt?...",
  "body": "hello world",
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
