# @maitask/http-request

Advanced HTTP client wrapper for Maitask Runtime.

## Features

- **Automatic Retries**: Exponential backoff for failed requests.
- **Timeout Handling**: Configurable timeouts.
- **Validation**: Status code validation.
- **JSON Support**: Automatic JSON serialization/parsing.
- **Detailed Metadata**: Response metadata including timing and attempts.

## Usage

### Simple GET

```json
{
  "package": "@maitask/http-request",
  "input": "https://api.example.com/data"
}
```

### Advanced POST

```json
{
  "package": "@maitask/http-request",
  "input": {
    "url": "https://api.example.com/users",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token123"
    },
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

## Response Format

```json
{
  "success": true,
  "status": 201,
  "statusText": "Created",
  "headers": {
    "content-type": "application/json"
  },
  "data": {
    "id": "123",
    "name": "John Doe"
  },
  "metadata": {
    "url": "https://api.example.com/users",
    "attempt": 1,
    "timestamp": "2023-10-27T10:00:00Z"
  }
}
```
