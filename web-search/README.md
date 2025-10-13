# @maitask/web-search

Search the web using multiple search engines.

## Features

- Multi-engine search (Google, Bing, DuckDuckGo with fallbacks)
- HTML content parsing with safe URL extraction
- Pagination support for all search engines
- Configurable result limits (up to 100 results per page)
- Integrated caching and rate limiting

## Configuration

### Required Options

- `query`: Search query string

### Optional Options

- `engine`: Search engine to use ('google', 'bing', 'duckduckgo') - defaults to duckduckgo with fallbacks
- `limit`: Maximum number of results per page (1-100) - defaults to 10
- `page`: Page number for pagination (1-based) - defaults to 1
- `offset`: Result offset for manual pagination control - defaults to calculated from page
- `language`: Language code (e.g., 'en', 'zh') - defaults to 'en'
- `region`: Region code (e.g., 'us', 'cn') - defaults to 'us'
- `includeSnippets`: Whether to include result snippets - defaults to true
- `safeSearch`: Safe search level ('strict', 'moderate', 'off') - defaults to 'moderate'

## Usage Examples

### Basic Web Search

```javascript
{
  "query": "Artificial intelligence trends 2025",
  "limit": 5,
  "engine": "duckduckgo"
}
```

### Advanced Search Options

```javascript
{
  "query": "Maitask engine documentation",
  "engine": "google",
  "limit": 10,
  "language": "en",
  "region": "us",
  "includeSnippets": true,
  "safeSearch": "moderate"
}
```

### Using with HTTP Headers

```javascript
{
  "query": "JavaScript framework comparison",
  "limit": 8,
  "headers": {
    "User-Agent": "Custom Bot 1.0"
  }
}
```

### Pagination Examples

#### Page-based Pagination

```javascript
// First page (default)
{
  "query": "machine learning",
  "limit": 10,
  "page": 1
}

// Second page
{
  "query": "machine learning",
  "limit": 10,
  "page": 2
}

// Third page with more results per page
{
  "query": "machine learning",
  "limit": 50,
  "page": 3
}
```

#### Offset-based Pagination

```javascript
// Skip first 20 results
{
  "query": "data science",
  "limit": 10,
  "offset": 20
}

// Skip first 100 results
{
  "query": "data science",
  "limit": 25,
  "offset": 100
}
```

## Return Value

Success response:
```javascript
{
  "success": true,
  "message": "Found X results for 'query'",
  "data": {
    "query": "search query",
    "engine": "search engine used",
    "page": 1,
    "offset": 0,
    "limit": 10,
    "totalResults": 10,
    "results": [
      {
        "rank": 1,
        "title": "Result Title",
        "url": "https://example.com",
        "domain": "example.com",
        "snippet": "Description text...",
        "searchEngine": "google"
      }
    ],
    "fetchedAt": "2025-01-27T10:30:00.000Z"
  },
  "metadata": {
    "sourceUrl": "original search URL"
  },
  "pagination": {
    "currentPage": 1,
    "hasNextPage": true,
    "nextPage": 2,
    "nextOffset": 10
  }
}
```

Error response:
```javascript
{
  "success": false,
  "message": "Search failed: error description",
  "error": "error details"
}
```