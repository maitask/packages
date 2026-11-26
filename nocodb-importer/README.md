# @maitask/nocodb-importer

Import data to NocoDB with authentication.

## Features

- Import CSV data to NocoDB tables
- Automatic table creation if not exists
- Data type inference for columns
- Dry run support to preview changes
- Authentication with xc-token

## Configuration

### Required Options

- `baseUrl`: NocoDB base URL (e.g. `https://your-nocodb-project.nocodb.com`)
- `token`: NocoDB authentication token
- `baseId`: NocoDB project base ID
- `tableName`: Target table name

### Optional Options

- `delimiter`: CSV delimiter character (default: `,`)
- `previewRows`: Number of rows for preview (`1`–`100`, default: `5`)
- `dryRun`: Only show preview, no actual import (default: `false`)
- `inferTypes`: Infer data types for columns (default: `true`)
- `fallbackColumnType` / `defaultColumnType`: Default column type for new tables (default: `SingleLineText`)
- `allowPrivateHosts`: Allow private/internal `baseUrl` targets (default: `false`)
- `timeoutMs`: Request timeout in milliseconds (default: `30000`)

## Usage Examples

### Basic Import

Pass CSV content in `input` and connection/table configuration in `options` (or `context.secrets.NOCODB_API_TOKEN` / `context.defaults`):

```javascript
const input = {
  content: 'name,age\nJohn,30\nJane,25'
};

const options = {
  baseUrl: 'https://your-nocodb-project.nocodb.com',
  token: 'your_xc_token',
  baseId: 'your_base_id',
  tableName: 'users'
};
```

### With Custom Delimiter

```javascript
const input = {
  content: 'id;name;price\n1;Product A;9.99\n2;Product B;14.99'
};

const options = {
  baseUrl: 'https://your-nocodb-project.nocodb.com',
  token: 'your_xc_token',
  baseId: 'your_base_id',
  tableName: 'inventory',
  delimiter: ';',
  inferTypes: true
};
```

### Dry Run Preview

```javascript
const input = {
  content: 'date,value\n2023-01-01,100\n2023-01-02,120'
};

const options = {
  baseUrl: 'https://your-nocodb-project.nocodb.com',
  token: 'your_xc_token',
  baseId: 'your_base_id',
  tableName: 'exports',
  dryRun: true
};
```

## Return Value

Success response:
```json
{
  "success": true,
  "data": {
    "importedRows": 10,
    "createdTable": true,
    "table": {},
    "response": {}
  },
  "metadata": {
    "package": "@maitask/nocodb-importer",
    "version": "0.1.1",
    "provider": "nocodb",
    "tableName": "users",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

Dry run response:
```json
{
  "success": true,
  "data": {
    "dryRun": true,
    "preview": [],
    "totalRows": 10,
    "columns": ["date", "value"]
  },
  "metadata": {
    "package": "@maitask/nocodb-importer",
    "version": "0.1.1",
    "provider": "nocodb",
    "tableName": "exports",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

Error response:
```json
{
  "success": false,
  "error": {
    "message": "Error details",
    "code": "NOCODB_IMPORT_ERROR",
    "type": "NocoDBImportError"
  },
  "metadata": {
    "package": "@maitask/nocodb-importer",
    "version": "0.1.1",
    "provider": "nocodb",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```
## Response Contract (Current)

The package uses a standardized envelope:

- Success: `{ success: true, data: {...}, metadata: {...} }`
- Failure: `{ success: false, error: { message, code, type }, metadata: {...} }`
