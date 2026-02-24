# @maitask/file-transformer

Transform structured content between json/csv/xml/yaml/toml.

## Features

- Bidirectional format conversion
- CSV escaping for output
- Simple YAML/TOML key-value support
- Uniform success/error payload structure

## Input

Required:
- `data`
- `from`
- `to`

## Example

```json
{
  "data": "{\"name\":\"Alice\",\"age\":30}",
  "from": "json",
  "to": "yaml"
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
