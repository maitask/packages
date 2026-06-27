# @maitask/http-request

Production-grade HTTP client wrapper for Maitask Runtime.

## Features

- Automatic retries with exponential backoff.
- Timeout handling through `AbortController`.
- Query parameter merging.
- Bearer, Basic, and API-key authentication helpers.
- JSON, URL-encoded form, multipart form, raw string, Blob, ArrayBuffer, and FormData request bodies.
- JSON, text, Blob, ArrayBuffer, and Base64 response parsing.
- Status validation with retryable status controls.
- Runtime-standardized `items` and `summary` metadata at the execution boundary.

## Usage

### Simple GET

```json
{
  "package": "@maitask/http-request",
  "input": "https://api.example.com/data"
}
```

### Query Parameters And Bearer Auth

```json
{
  "package": "@maitask/http-request",
  "input": {
    "url": "https://api.example.com/search",
    "params": {
      "q": "maitask",
      "tag": ["runtime", "packages"]
    },
    "auth": {
      "type": "bearer",
      "token": "$API_TOKEN"
    }
  }
}
```

`$API_TOKEN` is resolved from `context.secrets.API_TOKEN` or `context.env.API_TOKEN` when available.

### JSON POST

```json
{
  "package": "@maitask/http-request",
  "input": {
    "url": "https://api.example.com/users",
    "method": "POST",
    "body": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "timeout": 5000,
    "maxRetries": 3,
    "validateStatus": [200, 201]
  }
}
```

### Multipart Upload

```json
{
  "package": "@maitask/http-request",
  "input": {
    "url": "https://api.example.com/upload",
    "method": "POST",
    "multipart": {
      "file": {
        "filename": "report.txt",
        "contentType": "text/plain",
        "data": "SGVsbG8="
      },
      "name": "Daily report"
    }
  }
}
```

### Options

- `url`: Required URL.
- `method`: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`.
- `params` / `query`: Query parameters. Array values are appended repeatedly.
- `headers`: Request headers.
- `auth`: Authentication helper. Supports `bearer`, `basic`, and `apikey`.
- `body` / `data` / `json`: JSON body unless already a string, Blob, ArrayBuffer, FormData, or URLSearchParams.
- `form` / `formUrlEncoded`: URL-encoded form object.
- `multipart` / `formData`: Multipart form object.
- `timeout` / `timeoutMs`: Timeout in milliseconds. Default: `30000`.
- `responseType`: `json`, `text`, `blob`, `arraybuffer`, or `base64`. Default: `json`.
- `validateStatus`: Array of accepted statuses, `{ "min": 200, "max": 299 }`, function, `false`, or `"none"`.
- `maxRetries` / `retries`: Retry count. Default: `3`.
- `retryStatuses`: Status codes eligible for retry. Default: `408`, `425`, `429`, `500`, `502`, `503`, `504`.
- `retryMethods`: Methods eligible for status retry. Default: `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`.

## Response Format

Existing fields are preserved:

```json
{
  "success": true,
  "data": {
    "status": 201,
    "statusText": "Created",
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "id": "123"
    },
    "items": [
      {
        "status": 201,
        "statusText": "Created",
        "headers": {},
        "body": {
          "id": "123"
        }
      }
    ],
    "summary": {
      "total": 1,
      "successCount": 1,
      "failureCount": 0,
      "status": 201
    }
  },
  "metadata": {
    "package": "@maitask/http-request",
    "version": "1.1.0",
    "url": "https://api.example.com/users",
    "method": "POST",
    "attempt": 1,
    "attempts": 1,
    "executionMs": 42,
    "timestamp": "2026-06-27T10:00:00.000Z"
  }
}
```

Failures include parsed response details when the server returned a response body.
