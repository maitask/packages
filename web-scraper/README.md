# @maitask/web-scraper

Extract data from web pages with HTML parsing, CSS selectors, and XPath support.

## Features

- Extract content using CSS selectors, selector lists, descendant/child combinators, compound selectors, and attribute filters
- XPath selector support with descendant/child axes, predicates, text extraction, and attribute extraction
- HTML content parsing with metadata extraction
- Text and attribute extraction
- Configurable headers and options
- Multiple URL scraping support

## Configuration

### Required Input

- `url`: URL of the web page to scrape (string or object with `url` property)
- Or array of URLs for batch scraping

### Optional Options

- `selectors`: Object mapping names to CSS selector strings or selector descriptors
- `xpath`: Object mapping names to XPath expressions
- `headingLevels`: Array of heading levels to extract (default: ['h1', 'h2', 'h3'])
- `linkFilters`: Filter configuration for link extraction
  - `include`: Array of patterns that URLs must contain
  - `exclude`: Array of patterns to exclude from URLs
- `patterns`: Array of regex patterns to match in HTML
- `preserveWhitespace`: Keep original whitespace (default: false)
- `headers`: Custom HTTP headers

## Usage Examples

### Basic Web Scraping

```javascript
{
  "url": "https://example.com"
}
```

Returns: title, meta tags, headings, and links

### Using CSS Selectors

```javascript
{
  "url": "https://example.com",
  "selectors": {
    "mainTitle": "h1",
    "description": ".description",
    "productPrice": "#price",
    "featuredTitles": "article.featured[data-type=\"item\"] h2",
    "buyLinks": {
      "selector": "article.card a.buy",
      "attr": "href"
    }
  }
}
```

Supported CSS selectors:
- Tag selectors: `div`, `p`, `span`
- Class selectors: `.classname`
- ID selectors: `#elementid`
- Compound selectors: `article.card.featured`, `a#primary.cta`
- Descendant and child combinators: `article h2`, `section > article > h2`
- Selector lists: `h2, span.price`
- Attribute filters: `[data-type]`, `[data-type="item"]`, `[href^="/products"]`, `[href$=".pdf"]`, `[class~="active"]`, `[lang|="en"]`
- Attribute extraction descriptors: `{ "selector": "a.download", "attr": "href" }`

### Using XPath Selectors

```javascript
{
  "url": "https://example.com",
  "xpath": {
    "titles": "//h1/text()",
    "links": "//a/@href",
    "priceElements": "//span[@class='price']/text()",
    "dataItems": "//*[@data-type='item']"
  }
}
```

Supported XPath patterns:
- `//tag` - Select all matching descendants
- `/html/body/main` - Select by child path from the document root
- `//article/h2/text()` - Extract descendant text
- `//article//a/@href` - Extract descendant attribute values
- `//tag[@attr='value']` - Filter by attribute equality
- `//tag[@attr]` - Filter by attribute presence
- `//tag[contains(@class,'featured')]` - Filter by substring in an attribute
- `//h2[contains(text(),'Beta')]` - Filter by substring in text
- `//h2[normalize-space()='Alpha']` - Filter by normalized text
- `//article[1]` - Filter by 1-based position within the current matching tag set
- `//*[@attr='value']` - Select any element with an attribute value

### Advanced Configuration

```javascript
{
  "url": "https://example.com",
  "selectors": {
    "title": "h1",
    "content": ".main-content"
  },
  "xpath": {
    "prices": "//span[@class='price']/text()",
    "ratings": "//div[@class='rating']/@data-score"
  },
  "headingLevels": ["h1", "h2"],
  "linkFilters": {
    "include": ["/products/"],
    "exclude": ["/admin/", "/login/"]
  },
  "patterns": [
    {
      "name": "email",
      "pattern": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
      "flags": "gi"
    }
  ],
  "headers": {
    "User-Agent": "Mozilla/5.0 (compatible; MaitaskBot/1.0)"
  }
}
```

### Batch Scraping

```javascript
[
  { "url": "https://example.com/page1", "label": "Page 1" },
  { "url": "https://example.com/page2", "label": "Page 2" },
  "https://example.com/page3"
]
```

## Return Value

Success response:
```javascript
{
  "success": true,
  "data": {
    "total": 1,
    "successCount": 1,
    "failureCount": 0,
    "results": [
      {
        "url": "https://example.com",
        "label": null,
        "status": 200,
        "success": true,
        "title": "Page Title",
        "meta": {
          "description": "Page description",
          "keywords": "keyword1, keyword2",
          "author": "Author Name"
        },
        "headings": [
          { "level": "h1", "text": "Main Heading" },
          { "level": "h2", "text": "Subheading" }
        ],
        "links": [
          { "href": "https://example.com/page", "text": "Link text" }
        ],
        "patterns": [
          {
            "name": "email",
            "matches": ["contact@example.com", "info@example.com"]
          }
        ],
        "customData": {
          "mainTitle": ["Welcome to Example"],
          "prices": ["$19.99", "$29.99"],
          "ratings": ["4.5", "4.8"]
        },
        "fetchedAt": "2025-10-05T10:30:00.000Z"
      }
    ]
  },
  "metadata": {
    "package": "@maitask/web-scraper",
    "version": "0.1.0",
    "timestamp": "2025-10-05T10:30:00.000Z"
  }
}
```

Error response (for individual URL):
```javascript
{
  "success": true,
  "data": {
    "total": 1,
    "successCount": 0,
    "failureCount": 1,
    "results": [
      {
        "url": "https://example.com",
        "success": false,
        "error": "Request failed"
      }
    ]
  },
  "metadata": {
    "package": "@maitask/web-scraper",
    "version": "0.1.0",
    "timestamp": "2025-10-05T10:30:00.000Z"
  }
}
```

## XPath Examples

### Extract Text Content

```javascript
{
  "url": "https://example.com",
  "xpath": {
    "articleTitles": "//article/h2/text()",
    "paragraphs": "//p/text()"
  }
}
```

### Extract Attributes

```javascript
{
  "url": "https://example.com",
  "xpath": {
    "imageUrls": "//img/@src",
    "linkUrls": "//a/@href",
    "dataValues": "//div/@data-value"
  }
}
```

### Filter by Attribute

```javascript
{
  "url": "https://example.com",
  "xpath": {
    "productPrices": "//span[@class='price']/text()",
    "featuredItems": "//div[@data-featured='true']",
    "activeLinks": "//a[@class='active']/@href"
  }
}
```

## License

MIT
## Response Contract (Current)

The package uses a standardized envelope:

- Success: `{ success: true, data: { total, successCount, failureCount, results }, metadata: {...} }`
- Failure: `{ success: false, error: { message, code, type }, metadata: {...} }`
