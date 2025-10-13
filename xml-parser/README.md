# @maitask/xml-parser

XML to JSON parser with XPath support for Maitask.

## Features

- XML to JSON conversion
- Basic XPath queries
- Attribute preservation
- CDATA handling
- Self-closing tags
- Comment stripping

## Usage

### Parse XML

```bash
echo '<root><item id="1">Value</item></root>' | maitask run @maitask/xml-parser
```

### XPath Query

```bash
echo '<root><item>A</item><item>B</item></root>' | maitask run @maitask/xml-parser --options '{"operation":"query","xpath":"root/item"}'
```

## Operations

### Parse

Convert XML to JSON structure:

- `_tag`: Element name
- `_attributes`: Attributes object
- `_children`: Child elements array
- `_text`: Text content

### Query

Basic XPath support:
- `/path/to/element` - Direct path
- `*` - All children
- `**` - All descendants

## Example

Input:
```xml
<book id="123">
  <title>Example</title>
  <author>John Doe</author>
</book>
```

Output:
```json
{
  "_tag": "book",
  "_attributes": {
    "id": "123"
  },
  "_children": [
    {
      "_tag": "title",
      "_text": "Example"
    },
    {
      "_tag": "author",
      "_text": "John Doe"
    }
  ]
}
```

## Supported Features

- Element tags
- Attributes (`attr="value"`)
- Text content
- CDATA sections
- Self-closing tags (`<tag />`)
- Namespaces (`prefix:tag`)
- Comments (stripped)

## Use Cases

- RSS feed parsing
- SOAP API integration
- Configuration file processing
- Legacy system data extraction
- SVG parsing

## License

MIT
