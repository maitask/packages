# @maitask/file-processor

Powerful data processing and transformation engine.

## Features

- **Data Transformation**: Flexible field mapping and data restructuring
- **Advanced Filtering**: Multiple operators and complex conditions
- **Aggregation Operations**: Sum, count, average, min, max, median
- **Processing Pipelines**: Multi-step data processing workflows
- **Preprocessing**: Deduplication, flattening, and data cleanup
- **Sorting & Limiting**: Control output order and size
- **Type Conversion**: Automatic and explicit data type handling
- **Template System**: Dynamic value generation with templates

## Installation

```bash
npm install @maitask/file-processor
```

## Usage

### Basic Data Transformation

```javascript
const data = [
  { firstName: "John", lastName: "Doe", age: 30 },
  { firstName: "Jane", lastName: "Smith", age: 25 }
];

const result = execute(data, {
  operation: "transform",
  transformRules: {
    fullName: { template: "{{firstName}} {{lastName}}" },
    age: { from: "age", type: "number" },
    isAdult: { compute: { op: "map", field: "age", map: { "30": true, "25": true } } }
  }
});

console.log(result.result);
// [
//   { fullName: "John Doe", age: 30, isAdult: true },
//   { fullName: "Jane Smith", age: 25, isAdult: true }
// ]
```

### Advanced Filtering

```javascript
const sales = [
  { product: "Laptop", price: 1200, category: "Electronics" },
  { product: "Book", price: 15, category: "Education" },
  { product: "Phone", price: 800, category: "Electronics" }
];

const result = execute(sales, {
  operation: "filter",
  filterRules: [
    { field: "category", operator: "eq", value: "Electronics" },
    { field: "price", operator: "gt", value: 500 }
  ]
});

console.log(result.result);
// [{ product: "Laptop", price: 1200, category: "Electronics" },
//  { product: "Phone", price: 800, category: "Electronics" }]
```

### Data Aggregation

```javascript
const orders = [
  { customer: "John", amount: 100, region: "North" },
  { customer: "Jane", amount: 200, region: "North" },
  { customer: "Bob", amount: 150, region: "South" }
];

const result = execute(orders, {
  operation: "aggregate",
  aggregateRules: {
    groupBy: ["region"],
    metrics: [
      { op: "sum", field: "amount", as: "totalAmount" },
      { op: "count", as: "orderCount" },
      { op: "avg", field: "amount", as: "avgAmount" }
    ]
  }
});

console.log(result.result);
// [
//   { region: "North", totalAmount: 300, orderCount: 2, avgAmount: 150 },
//   { region: "South", totalAmount: 150, orderCount: 1, avgAmount: 150 }
// ]
```

### Processing Pipeline

```javascript
const rawData = [
  { name: "john doe", email: "JOHN@EXAMPLE.COM", score: "85" },
  { name: "jane smith", email: "jane@test.com", score: "92" },
  { name: "", email: "invalid", score: "75" }
];

const result = execute(rawData, {
  operation: "pipeline",
  pipeline: [
    {
      type: "transform",
      rules: {
        name: { from: "name", transform: ["trim", "uppercase"] },
        email: { from: "email", transform: ["lowercase"] },
        score: { from: "score", type: "number" }
      }
    },
    {
      type: "filter",
      rules: [
        { field: "name", operator: "exists" },
        { field: "email", operator: "contains", value: "@" },
        { field: "score", operator: "gte", value: 80 }
      ]
    },
    {
      type: "sort",
      by: [{ field: "score", direction: "desc" }]
    }
  ]
});
```

## Configuration Options

### Operations

| Operation | Description |
|-----------|-------------|
| `transform` | Transform data structure and values |
| `filter` | Filter records based on conditions |
| `aggregate` | Perform aggregation operations |
| `pipeline` | Execute multiple processing steps |

### Transform Rules

```javascript
{
  transformRules: {
    // Simple field mapping
    "newField": "oldField",

    // Complex transformation
    "fullName": {
      template: "{{firstName}} {{lastName}}"
    },

    // Type conversion
    "age": {
      from: "ageString",
      type: "number",
      default: 0
    },

    // Computed values
    "total": {
      compute: {
        op: "sum",
        fields: ["price", "tax"]
      }
    },

    // Value transformation
    "name": {
      from: "rawName",
      transform: ["trim", "uppercase"],
      type: "string"
    }
  }
}
```

### Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `{ field: "status", operator: "eq", value: "active" }` |
| `neq` | Not equals | `{ field: "type", operator: "neq", value: "draft" }` |
| `gt` | Greater than | `{ field: "age", operator: "gt", value: 18 }` |
| `gte` | Greater or equal | `{ field: "score", operator: "gte", value: 80 }` |
| `lt` | Less than | `{ field: "price", operator: "lt", value: 100 }` |
| `lte` | Less or equal | `{ field: "quantity", operator: "lte", value: 10 }` |
| `contains` | Contains substring | `{ field: "email", operator: "contains", value: "@" }` |
| `starts_with` | Starts with | `{ field: "name", operator: "starts_with", value: "Mr" }` |
| `ends_with` | Ends with | `{ field: "file", operator: "ends_with", value: ".pdf" }` |
| `in` | In array | `{ field: "category", operator: "in", value: ["A", "B"] }` |
| `exists` | Field exists | `{ field: "optional", operator: "exists" }` |
| `regex` | Regex match | `{ field: "phone", operator: "regex", value: "\\d{3}-\\d{4}" }` |

### Aggregation Operations

| Operation | Description |
|-----------|-------------|
| `count` | Count records |
| `sum` | Sum numeric values |
| `avg` | Average of numeric values |
| `min` | Minimum value |
| `max` | Maximum value |
| `median` | Median value |
| `count_distinct` | Count unique values |

### Preprocessing Options

```javascript
{
  preprocess: [
    {
      type: "deduplicate",
      keys: ["email"]  // Remove duplicates by email
    },
    {
      type: "remove_empty"  // Remove empty records
    },
    {
      type: "flatten",
      field: "items"  // Flatten nested arrays
    }
  ]
}
```

## Output Format

```javascript
{
  success: true,
  operation: "transform",
  result: [...],  // Processed data
  metadata: {
    operation: "transform",
    inputCount: 10,
    outputCount: 8,
    steps: [...],   // Processing steps applied
    fields: [...],  // Available fields in result
    executedAt: "2023-01-15T10:30:00.000Z",
    version: "0.1.0"
  }
}
```

## Advanced Examples

### Complex Data Transformation

```javascript
const customerData = [
  {
    customer: { firstName: "John", lastName: "Doe" },
    orders: [
      { product: "Laptop", price: 1000 },
      { product: "Mouse", price: 50 }
    ],
    joinDate: "2023-01-15"
  }
];

const result = execute(customerData, {
  operation: "pipeline",
  pipeline: [
    {
      type: "transform",
      rules: {
        fullName: { template: "{{customer.firstName}} {{customer.lastName}}" },
        totalSpent: { compute: { op: "sum", fields: ["orders.0.price", "orders.1.price"] } },
        memberSince: { from: "joinDate", type: "date" },
        orderCount: { compute: { op: "length", field: "orders" } }
      }
    },
    {
      type: "filter",
      rules: [
        { field: "totalSpent", operator: "gt", value: 500 }
      ]
    }
  ]
});
```

### Dynamic Field Processing

```javascript
const salesData = [
  { Q1: 1000, Q2: 1200, Q3: 900, Q4: 1100, year: 2023 },
  { Q1: 800, Q2: 950, Q3: 1050, Q4: 1200, year: 2023 }
];

const result = execute(salesData, {
  operation: "transform",
  transformRules: {
    year: "year",
    totalSales: {
      compute: {
        op: "sum",
        fields: ["Q1", "Q2", "Q3", "Q4"]
      }
    },
    avgQuarterly: {
      compute: {
        op: "avg",
        fields: ["Q1", "Q2", "Q3", "Q4"]
      }
    },
    bestQuarter: {
      compute: {
        op: "max",
        fields: ["Q1", "Q2", "Q3", "Q4"]
      }
    }
  }
});
```

### Conditional Processing

```javascript
const userData = [
  { name: "John", age: 25, type: "premium" },
  { name: "Jane", age: 17, type: "basic" },
  { name: "Bob", age: 35, type: "premium" }
];

const result = execute(userData, {
  operation: "transform",
  transformRules: {
    name: "name",
    ageGroup: {
      compute: {
        op: "map",
        field: "age",
        map: {
          // This would need custom logic for ranges
        },
        defaultValue: "adult"
      }
    },
    canVote: {
      compute: {
        op: "map",
        field: "age",
        defaultValue: false
      }
    }
  }
});
```

## Performance Tips

1. **Use preprocessing** to reduce data size early in the pipeline
2. **Filter before aggregation** to improve performance
3. **Limit output size** with the `limit` option for large datasets
4. **Use specific field transformations** instead of processing all fields
5. **Cache complex computations** by storing intermediate results

## Error Handling

The processor provides detailed error information for debugging:

```javascript
try {
  const result = execute(data, options);
  if (!result.success) {
    console.error('Processing failed:', result.error);
  }
} catch (error) {
  console.error('Execution error:', error.message);
}
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
- Data transformation engine
- Advanced filtering capabilities
- Aggregation operations
- Multi-step processing pipelines
- Preprocessing utilities
- Comprehensive type system
