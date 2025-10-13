# @maitask/markdown-renderer

Markdown to HTML converter with template support for Maitask.

## Features

- Convert Markdown to HTML
- Plain text extraction
- Template rendering
- Code blocks with syntax highlighting placeholders
- Tables, lists, blockquotes
- Links and images

## Usage

### HTML Output

```bash
echo '# Hello\n\nThis is **bold** text.' | maitask run @maitask/markdown-renderer
```

### Plain Text Output

```bash
echo '# Hello\n\nThis is **bold** text.' | maitask run @maitask/markdown-renderer --options '{"format":"plain"}'
```

### With Template

```bash
echo '# Title' | maitask run @maitask/markdown-renderer --options '{
  "template": "<!DOCTYPE html><html><head><title>{{title}}</title></head><body>{{content}}</body></html>",
  "templateVars": {"title": "My Page"}
}'
```

## Supported Markdown

- Headings: `# H1` to `###### H6`
- Bold: `**text**` or `__text__`
- Italic: `*text*` or `_text_`
- Links: `[text](url)`
- Images: `![alt](url)`
- Code: `` `inline` `` and ` ```blocks``` `
- Lists: `- item` and `1. item`
- Blockquotes: `> text`
- Tables: `| col1 | col2 |`
- Horizontal rules: `---`

## Options

- `format`: Output format (`html` or `plain`)
- `template`: HTML template with `{{content}}` placeholder
- `templateVars`: Variables for template substitution

## License

MIT
