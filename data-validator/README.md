# @maitask/data-validator

Comprehensive data validation and quality assurance.

## Features

- **JSON Schema Validation**: Full support for JSON Schema specifications
- **Custom Validation Rules**: Flexible rule engine for domain-specific validation
- **Data Type Checking**: Automatic type validation and conversion
- **Data Quality Analysis**: Detect common data quality issues
- **Multiple Validation Modes**: Strict, loose, and report-only modes
- **Detailed Error Reporting**: Comprehensive validation results with location info
- **Batch Processing**: Validate arrays of data efficiently
- **Extensible Rules**: Add custom validation patterns and rules

## Installation

```bash
npm install @maitask/data-validator
```

## Usage

### Basic Validation

```javascript
const data = [
  { name: "John Doe", email: "john@example.com", age: 30 },
  { name: "Jane Smith", email: "invalid-email", age: "25" }
];

const result = execute(data, {
  required_fields: ["name", "email"],
  data_types: {
    "name": "string",
    "email": "string",
    "age": "number"
  }
});

console.log(result.success); // false
console.log(result.data.summary);
// {
//   total_count: 2,
//   valid_count: 1,
//   invalid_count: 1,
//   validation_rate: 50
// }
```

### Schema Validation

```javascript
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    age: { type: "number", minimum: 0, maximum: 150 }
  },
  required: ["name", "email"]
};

const result = execute(userData, {
  schema: schema,
  validation_mode: "strict"
});
```

### Custom Validation Rules

```javascript
const result = execute(data, {
  custom_rules: [
    {
      field: "email",
      rule: "email",
      message: "Invalid email format"
    },
    {
      field: "age",
      rule: "positive",
      message: "Age must be a positive number"
    },
    {
      field: "username",
      rule: "not-empty",
      message: "Username cannot be empty"
    }
  ]
});
```

### Advanced Configuration

```javascript
const result = execute(data, {
  validation_mode: "report-only",  // Don't fail, just report issues
  required_fields: ["id", "name", "email"],
  data_types: {
    "id": "number",
    "name": "string",
    "email": "string",
    "created_at": "string"
  },
  custom_rules: [
    { field: "email", rule: "email" },
    { field: "website", rule: "url" },
    { field: "score", rule: "numeric" }
  ],
  stop_on_first_error: false
});
```

## Configuration Options

### Validation Modes

| Mode | Description |
|------|-------------|
| `strict` | Fail validation on any error (default) |
| `loose` | Allow warnings, fail only on critical errors |
| `report-only` | Never fail, just collect and report issues |

### Built-in Validation Rules

| Rule | Description | Example |
|------|-------------|---------|
| `email` | Valid email format | `user@domain.com` |
| `url` | Valid HTTP/HTTPS URL | `https://example.com` |
| `not-empty` | Non-empty string | Any non-empty string |
| `numeric` | Valid number | `123`, `45.67` |
| `positive` | Positive number | Any number > 0 |

### Configuration Schema

```javascript
{
  schema: {
    type: "object",               // JSON Schema object
    properties: { ... }
  },
  schema_url: "https://...",      // URL to fetch schema from
  validation_mode: "strict",      // "strict" | "loose" | "report-only"
  required_fields: ["id", "name"], // Array of required field names
  data_types: {                   // Expected data types
    "field_name": "string"        // "string" | "number" | "boolean" | "object"
  },
  custom_rules: [                 // Custom validation rules
    {
      field: "email",
      rule: "email",
      message: "Invalid email"
    }
  ],
  stop_on_first_error: false      // Stop processing on first error
}
```

## Output Format

### Success Response

```javascript
{
  success: true,
  message: "Validation completed: 10/10 items valid",
  data: {
    summary: {
      total_count: 10,
      valid_count: 10,
      invalid_count: 0,
      error_count: 0,
      warning_count: 2,
      validation_rate: 100,
      error_breakdown: {}
    },
    results: [
      {
        index: 0,
        valid: true,
        errors: [],
        warnings: [],
        data: { ... }
      }
    ],
    schema_used: true,
    validation_mode: "strict"
  },
  metadata: {
    validated_at: "2023-01-15T10:30:00.000Z",
    validation_mode: "strict",
    schema_source: "inline",
    version: "0.1.0"
  }
}
```

### Error Response

```javascript
{
  success: false,
  error: {
    message: "Validation error details",
    code: "VALIDATION_ERROR",
    type: "ValidationError",
    details: null
  },
  metadata: {
    validated_at: "2023-01-15T10:30:00.000Z",
    version: "0.1.0"
  }
}
```

### Validation Results Detail

```javascript
{
  index: 0,                    // Item index in array
  valid: false,               // Overall validation status
  errors: [                   // Validation errors
    {
      field: "email",
      rule: "email",
      message: "Invalid email format",
      severity: "error"
    }
  ],
  warnings: [                 // Data quality warnings
    {
      field: "name",
      rule: "data-quality",
      message: "Field contains only whitespace",
      severity: "warning"
    }
  ],
  data: { ... }              // Original data item
}
```

## Advanced Examples

### Complex Schema Validation

```javascript
const productSchema = {
  type: "object",
  properties: {
    id: { type: "number", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    price: { type: "number", minimum: 0 },
    category: {
      type: "string",
      enum: ["electronics", "clothing", "books", "home"]
    },
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 10
    },
    specifications: {
      type: "object",
      properties: {
        weight: { type: "number" },
        dimensions: { type: "string" }
      }
    }
  },
  required: ["id", "name", "price", "category"]
};

const result = execute(products, {
  schema: productSchema,
  validation_mode: "strict"
});
```

### Multi-Level Validation

```javascript
const result = execute(customerData, {
  required_fields: ["customer.id", "customer.email", "orders.0.total"],
  data_types: {
    "customer.id": "number",
    "customer.email": "string",
    "orders.0.total": "number"
  },
  custom_rules: [
    { field: "customer.email", rule: "email" },
    { field: "orders.0.total", rule: "positive" }
  ]
});
```

### Conditional Validation

```javascript
// Validate different rules based on user type
const validateUser = (userData) => {
  const baseRules = {
    required_fields: ["id", "email", "type"],
    custom_rules: [
      { field: "email", rule: "email" }
    ]
  };

  if (userData.type === "premium") {
    baseRules.required_fields.push("subscription_id");
    baseRules.custom_rules.push({
      field: "subscription_id",
      rule: "not-empty"
    });
  }

  return execute(userData, baseRules);
};
```

### Batch Validation with Custom Processing

```javascript
const validateBatch = (dataArray, options = {}) => {
  const result = execute(dataArray, {
    validation_mode: "report-only",
    ...options
  });

  // Process results
  const validItems = result.data.results.filter(r => r.valid);
  const invalidItems = result.data.results.filter(r => !r.valid);

  console.log(`Processed ${result.data.summary.total_count} items`);
  console.log(`Valid: ${validItems.length}, Invalid: ${invalidItems.length}`);

  // Log detailed errors
  invalidItems.forEach(item => {
    console.log(`Item ${item.index} errors:`, item.errors);
  });

  return {
    valid: validItems.map(r => r.data),
    invalid: invalidItems.map(r => ({ data: r.data, errors: r.errors })),
    summary: result.data.summary
  };
};
```

## Data Quality Checks

The validator automatically performs data quality checks:

- **Empty string detection**: Identifies fields with only whitespace
- **Suspicious values**: Detects common placeholder values like "null", "N/A", etc.
- **Type inconsistencies**: Flags unexpected data types
- **Missing required fields**: Validates required field presence
- **Format validation**: Checks email, URL, and other format patterns

## Performance Considerations

- **Batch processing**: Validate arrays efficiently with single configuration
- **Early termination**: Use `stop_on_first_error` for faster failure detection
- **Schema caching**: Reuse schema objects for multiple validations
- **Selective validation**: Validate only necessary fields to improve performance

## Error Handling

```javascript
try {
  const result = execute(data, options);

  if (!result.success) {
    console.log('Validation failed:', result.message);
    // Handle validation errors
    result.data.results.forEach(item => {
      if (!item.valid) {
        console.log(`Item ${item.index}:`, item.errors);
      }
    });
  } else {
    console.log('All data is valid!');
  }
} catch (error) {
  console.error('Validation execution failed:', error.message);
}
```

## Integration Examples

### With CSV Parser

```javascript
// Validate CSV data after parsing
const csvResult = csvParser.execute(csvData);
const validationResult = execute(csvResult.rows, {
  required_fields: ["id", "name", "email"],
  custom_rules: [
    { field: "email", rule: "email" }
  ]
});
```

### With File Processor

```javascript
// Transform then validate
const processed = fileProcessor.execute(rawData, {
  operation: "transform",
  transformRules: { ... }
});

const validated = execute(processed.result, {
  schema: outputSchema
});
```

## Requirements

- Node.js >= 14.0.0
- Maitask Engine >= 1.0.0

## License

MIT © Maitask Team

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add comprehensive tests
4. Submit a pull request

## Changelog

### 0.1.0

- Initial release
- JSON Schema validation support
- Custom validation rules engine
- Data quality analysis
- Multiple validation modes
- Comprehensive error reporting
- Batch processing capabilities
