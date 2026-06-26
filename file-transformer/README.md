# @maitask/file-transformer

Transform structured content between json/csv/xml/yaml/toml.

## Features

- Bidirectional format conversion
- RFC4180-style CSV parsing and escaping, including quoted delimiters and embedded newlines
- Header inference, duplicate header handling, union headers for object export, and optional scalar type inference
- Recursive XML parsing and serialization with attributes, repeated elements, text nodes, CDATA, and XML declarations
- Nested YAML maps/sequences with quoted strings, comments, inline arrays/objects, numbers, booleans, and nulls
- TOML sections, dotted keys, arrays, inline objects, and array-of-table parsing/serialization
- Uniform success/error payload structure

## Input

Required:
- `data`
- `from`
- `to`

Optional:
- `options.delimiter` / `options.csvDelimiter`: CSV delimiter, default `,`
- `options.header` / `options.csvHeader`: use first CSV row as headers, default `true`
- `options.headers`: explicit CSV headers
- `options.inferTypes`: infer CSV scalar types, default `true`
- `options.rootName`: XML root name for non-rooted JSON values, default `root`
- `options.itemName`: XML item name for list values, default `item`
- `options.xmlDeclaration`: include XML declaration, default `true`
- `options.yamlIndent`: YAML indentation width, default `2`
- `options.includeParsed`: include the intermediate parsed value in the response, default `false`

## Example

```json
{
  "data": "{\"name\":\"Alice\",\"age\":30}",
  "from": "json",
  "to": "yaml"
}
```

CSV with quoted fields:
```json
{
  "data": "name,notes,active\nAlice,\"hello, world\",true\nBob,\"line\nwrap\",false\n",
  "from": "csv",
  "to": "json"
}
```

XML to JSON:
```json
{
  "data": "<catalog><book id=\"1\"><title>Alpha</title><tag>one</tag><tag>two</tag></book></catalog>",
  "from": "xml",
  "to": "json"
}
```

TOML to YAML:
```json
{
  "data": "title = \"Demo\"\n[owner]\nname = \"Alice\"\n[[products]]\nsku = \"A1\"\nprice = 12.5\n",
  "from": "toml",
  "to": "yaml"
}
```

## Return Shape

Success:
```json
{
  "success": true,
  "data": {
    "from": "json",
    "to": "yaml",
    "output": "name: Alice\nage: 30"
  },
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
