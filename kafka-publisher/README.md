# @maitask/kafka-publisher

Publish one or more records to Kafka via REST proxy.

## Features

- Single or batch message support
- Kafka REST proxy compatible payload
- Offset data passthrough
- Timeout and error normalization

## Input

Required:
- `proxyUrl`
- `topic`
- `messages`

Optional:
- `key`
- `headers`
- `timeoutMs`

## Example

```json
{
  "proxyUrl": "https://kafka-proxy.internal",
  "topic": "user.events",
  "messages": [
    {
      "event": "signup",
      "user_id": "u-1"
    },
    {
      "event": "login",
      "user_id": "u-1"
    }
  ],
  "key": "u-1"
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
