# @maitask/yaml-converter

YAML to JSON bidirectional converter for Maitask.

## Features

- YAML to JSON conversion
- JSON to YAML conversion
- Auto-detection of input format
- Type preservation (strings, numbers, booleans, null)
- Configurable indentation
- Comments handling

## Usage

### YAML to JSON

```bash
echo 'name: John\nage: 30' | maitask run @maitask/yaml-converter
```

### JSON to YAML

```bash
echo '{"name":"John","age":30}' | maitask run @maitask/yaml-converter
```

### Custom Indentation

```bash
echo '{"data":{"nested":"value"}}' | maitask run @maitask/yaml-converter --options '{"indent":4}'
```

### Explicit Direction

```bash
echo 'data' | maitask run @maitask/yaml-converter --options '{"direction":"yaml-to-json"}'
```

## Options

- `direction`: `auto`, `yaml-to-json`, or `json-to-yaml` (default: `auto`)
- `indent`: Number of spaces for YAML indentation (default: `2`)

## Supported YAML Features

- Scalars (strings, numbers, booleans, null)
- Sequences (arrays with `- ` syntax)
- Mappings (objects with `key: value` syntax)
- Nested structures
- Comments (preserved in parsing, stripped in output)
- Quoted strings (`"..."` or `'...'`)

## Example

Input YAML:
```yaml
name: John Doe
age: 30
active: true
roles:
  - admin
  - user
```

Output JSON:
```json
{
  "name": "John Doe",
  "age": 30,
  "active": true,
  "roles": ["admin", "user"]
}
```

## Use Cases

- Configuration file conversion
- API response transformation
- Data format migration
- CI/CD pipeline processing

## License

MIT
