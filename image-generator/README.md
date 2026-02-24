# @maitask/image-generator

Generate images through OpenAI or Stability APIs.

## Features

- OpenAI and Stability provider support
- Provider-specific payload handling
- Normalized image result list
- Timeout and structured error handling

## Input

Required:
- `prompt`
- `apiKey`

Optional:
- `provider`
- `model`
- `size`
- `n`
- `width`
- `height`
- `timeoutMs`

## Example

```json
{
  "prompt": "A minimalistic poster of a robotic crane at sunset",
  "provider": "openai",
  "model": "dall-e-3",
  "size": "1024x1024",
  "apiKey": "sk-xxx"
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
