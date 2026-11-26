# @maitask/hackernews-crawler

Crawl and extract stories from Hacker News using official API v0.

## Features

- Fetch top stories, new stories, best stories, ask stories, show stories, and job stories
- Extract detailed story information with metadata
- Fetch comments with configurable depth
- Get comprehensive story data including titles, URLs, authors, scores

## Configuration

### Optional Options

- `storyType`: Type of stories to fetch ('top', 'new', 'best', 'ask', 'show', 'job') - default: 'top'
- `limit`: Maximum number of stories to return (1-100) - default: 30
- `includeComments`: Whether to include comments - default: false
- `commentLimit`: Maximum number of comments to fetch per story - default: 5
- `commentDepth`: Maximum comment reply depth - default: 1

## Usage Examples

### Basic Hacker News Stories

```javascript
{
  "storyType": "top",
  "limit": 10
}
```

### Get New Stories with Limit

```javascript
{
  "storyType": "new",
  "limit": 25
}
```

### Get Show HN Stories

```javascript
{
  "storyType": "show",
  "limit": 15
}
```

### Include Comments (Basic)

```javascript
{
  "storyType": "top",
  "limit": 5,
  "includeComments": true,
  "commentLimit": 3
}
```

### Deep Comment Traversal

```javascript
{
  "storyType": "ask",
  "limit": 5,
  "includeComments": true,
  "commentLimit": 10,
  "commentDepth": 2
}
```

## Return Value

Success response:

```json
{
  "success": true,
  "data": {
    "storyType": "top",
    "totalStories": 2,
    "stories": [
      {
        "id": 123456,
        "title": "Story title",
        "url": "https://example.com",
        "author": "author_name",
        "score": 150,
        "time": "2025-01-27T10:30:00.000Z",
        "commentCount": 45,
        "type": "story",
        "text": "Story text if applicable",
        "comments": []
      }
    ]
  },
  "metadata": {
    "package": "@maitask/hackernews-crawler",
    "version": "0.1.1",
    "provider": "hackernews",
    "storyType": "top",
    "fetchedAt": "2025-01-27T10:30:00.000Z",
    "requested": 2,
    "delivered": 2
  }
}
```

Each comment object includes `id`, `author`, `time`, `text`, `parent`, `deleted`, and nested `children` when `commentDepth > 1`.

Failure response:

```json
{
  "success": false,
  "error": {
    "message": "Error details",
    "code": "HACKERNEWS_CRAWLER_ERROR",
    "type": "HackerNewsCrawlerError"
  },
  "metadata": {
    "package": "@maitask/hackernews-crawler",
    "version": "0.1.1",
    "provider": "hackernews",
    "fetchedAt": "2025-01-27T10:30:00.000Z"
  }
}
```
