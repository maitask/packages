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

- `delimiter`: CSV delimiter character (default: ,)
- `previewRows`: Number of rows for preview (default: 5)
- `dryRun`: Only show preview, no actual import (default: false)
- `inferTypes`: Infer data types for columns (default: true)
- `fallbackColumnType`: Default column type for new tables (default: SingleLineText)

## Usage Examples

### Basic Import

```javascript
{
  "baseUrl": "https://your-nocodb-project.nocodb.com",
  "token": "your_xc_token",
  "baseId": "your_base_id",
  "tableName": "users",
  "content": "name,age\nJohn,30\nJane,25"
}
```

### With Custom Delimiter

```javascript
{
  "baseUrl": "https://your-nocodb-project.nocodb.com",
  "token": "your_xc_token",
  "baseId": "your_base_id",
  "tableName": "inventory",
  "delimiter": ";",
  "inferTypes": true,
  "content": "id;name;price\n1;Product A;9.99\n2;Product B;14.99"
}
```

### Dry Run Preview

```javascript
{
  "baseUrl": "https://your-nocodb-project.nocodb.com",
  "token": "your_xc_token",
  "baseId": "your_base_id",
  "tableName": "exports",
  "dryRun": true,
  "content": "date,value\n2023-01-01,100\n2023-01-02,120"
}
```

### Advanced Configuration

```javascript
{
  "baseUrl": "https://your-nocodb-project.nocodb.com",
  "token": "your_xc_token",
  "baseId": "your_base_id",
  "tableName": "products",
  "delimiter": ",",
  "previewRows": 10,
  "inferTypes": true,
  "fallbackColumnType": "LongText"
}
```

## Return Value

Success response:
```javascript
{
  "success": true,
  "message": "Successfully imported X rows",
  "result": {
    "importedRows": 10,
    "createdTable": true,
    "table": { /* NocoDB table info */ },
    "response": { /* NocoDB API response */ }
  }
}
```

Dry run response:
```javascript
{
  "success": true,
  "message": "Dry run completed. No data sent to NocoDB.",
  "preview": [ /* First previewRows of data */ ],
  "totalRows": 10,
  "columns": [ /* Column names from CSV */ ]
}
```

Error response:
```javascript
{
  "success": false,
  "message": "Error details"
}
```