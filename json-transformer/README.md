# @maitask/json-transformer

JSONPath query and data transformation package for Maitask.

## Features

- JSONPath query support
- Data mapping and transformation
- Property extraction and filtering
- Array operations
- Flatten/unflatten objects
- Multiple transformation operators

## Operations

### Query

Extract data using JSONPath syntax:

```javascript
{
  "operation": "query",
  "path": "$.users[0].name"
}
```

Supported syntax:
- `$` - Root
- `$.prop` - Property access
- `$.arr[0]` - Array index
- `$.*` - Wildcard
- `$..prop` - Recursive search

### Map

Transform data structure:

```javascript
{
  "operation": "map",
  "mapping": {
    "fullName": "user.name",
    "email": "user.contact.email"
  }
}
```

### Filter

Filter array by conditions:

```javascript
{
  "operation": "filter",
  "condition": {
    "age": { "$gte": 18 },
    "status": "active"
  }
}
```

Operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`

### Extract

Extract specific fields:

```javascript
{
  "operation": "extract",
  "fields": ["id", "name", "email"]
}
```

### Flatten

Flatten nested object:

```javascript
{
  "operation": "flatten",
  "separator": "."
}
```

### Unflatten

Restore nested structure:

```javascript
{
  "operation": "unflatten",
  "separator": "."
}
```

## Usage

```bash
# Query
echo '{"data":{"user":{"name":"Alice"}}}' | maitask run @maitask/json-transformer --options '{"operation":"query","path":"$.user.name"}'

# Map
echo '{"user":{"name":"Alice","age":30}}' | maitask run @maitask/json-transformer --options '{"operation":"map","mapping":{"name":"user.name"}}'

# Filter
echo '[{"age":25},{"age":35}]' | maitask run @maitask/json-transformer --options '{"operation":"filter","condition":{"age":{"$gte":30}}}'
```

## License

MIT
