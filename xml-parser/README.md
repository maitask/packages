# @maitask/xml-parser

XML to JSON parser with XPath support for Maitask.

## Features

- XML to JSON conversion
- XPath queries with absolute/relative paths, descendant axis, predicates, text output, and attribute output
- Attribute preservation
- CDATA handling
- Self-closing tags
- Comment stripping
- Namespace-prefixed element and attribute names

## Usage

### Parse XML

```bash
echo '<root><item id="1">Value</item></root>' | maitask run @maitask/xml-parser
```

### XPath Query

```bash
echo '<root><item id="1">A</item><item id="2">B</item></root>' | maitask run @maitask/xml-parser --options '{"operation":"query","xpath":"//item[@id=\"2\"]/text()"}'
```

## Operations

### Parse

Convert XML to JSON structure:

- `_tag`: Element name
- `_attributes`: Attributes object
- `_children`: Child elements array
- `_text`: Text content

### Query

Supported XPath patterns:
- `root/item` - Relative path from the parsed root
- `/root/item` - Absolute-style path that can include the parsed root element
- `//item` - Descendant search
- `//item[1]` - 1-based position within the current matching tag set
- `//item[@id]` - Attribute presence predicate
- `//item[@id="2"]` - Attribute equality predicate
- `//item[contains(@class,"featured")]` - Attribute substring predicate
- `//item[text()="A"]` - Text equality predicate
- `//item[contains(text(),"A")]` - Text substring predicate
- `//book[price>30]/title` - Child text comparison predicate
- `//item/text()` - Text output
- `//item/@id` - Attribute output

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
      "_attributes": {},
      "_children": [],
      "_text": "Example"
    },
    {
      "_tag": "author",
      "_attributes": {},
      "_children": [],
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
- XML declarations and processing instructions
- Doctype declarations, including internal subsets

## Use Cases

- RSS feed parsing
- SOAP API integration
- Configuration file processing
- Enterprise system data extraction
- SVG parsing

## License

MIT
