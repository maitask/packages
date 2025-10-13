# @maitask/url-analyzer

URL parsing, validation, and analysis for Maitask.

## Features

- URL component extraction
- Query string parsing
- URL validation
- URL normalization
- Domain analysis
- Security checks

## Operations

### Parse

Extract all URL components:

```bash
echo 'https://user:pass@example.com:8080/path?key=value#section' | maitask run @maitask/url-analyzer
```

### Validate

Validate URL format and components:

```bash
echo 'https://example.com' | maitask run @maitask/url-analyzer --options '{"operation":"validate"}'
```

### Normalize

Normalize URL to canonical form:

```bash
echo 'HTTPS://EXAMPLE.COM:443/PATH//' | maitask run @maitask/url-analyzer --options '{"operation":"normalize"}'
```

### Query

Parse query string parameters:

```bash
echo 'https://example.com?foo=bar&baz=qux' | maitask run @maitask/url-analyzer --options '{"operation":"query"}'
```

### Analyze

Complete URL analysis:

```bash
echo 'https://api.example.com/v1/users?active=true' | maitask run @maitask/url-analyzer --options '{"operation":"analyze"}'
```

## Parse Output

```json
{
  "protocol": "https",
  "username": "user",
  "password": "pass",
  "hostname": "example.com",
  "port": 8080,
  "path": "/path",
  "query": "key=value",
  "queryParams": {
    "key": "value"
  },
  "fragment": "section"
}
```

## Analyze Output

Includes parsed components plus:

- Domain breakdown (subdomain, domain, TLD)
- Path analysis (segments, depth, extension)
- Query parameter count
- Security indicators (HTTPS, authentication)

## Use Cases

- Link validation and sanitization
- SEO analysis
- Security auditing
- API endpoint parsing
- Web scraping preparation

## License

MIT
