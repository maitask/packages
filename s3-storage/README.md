# @maitask/s3-storage

Work with S3-compatible storage through presigned object URLs.

## Features

- Operations: upload, download, delete
- Requires a presigned URL for each object operation
- Consistent metadata and timeout handling

## Input

Required:

- `operation`
- `presignedUrl`

Optional:

- `body` (required for upload)
- `headers`
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
