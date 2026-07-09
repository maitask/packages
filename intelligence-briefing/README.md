# @maitask/intelligence-briefing

Generate multi-source intelligence briefings with filtering, deduplication state, OpenAI-compatible analysis, translation, and channel-neutral output.

## Features

- Hacker News source adapter with story type, comment, retry, timeout, and fixture-base support
- Upstream package input support for `@maitask/hackernews-crawler` results
- Analysis profiles: `business`, `economic`, `forecast`, `technology`, `market`, `risk`, `policy`, `investment`, and `custom`
- OpenAI-compatible provider support through configurable `baseUrl`
- Target-language output for multilingual channel briefings
- Explicit deduplication state contract for recurring workflows
- Bot-ready `message` output for Plane output adapters

## Recommended Workflow

```text
Schedule
  -> @maitask/hackernews-crawler
  -> @maitask/intelligence-briefing
  -> Telegram output adapter
```

The package produces the briefing. Plane user adapters deliver it to Telegram, DingTalk, Feishu, Discord, Slack, or another destination.

## Input

```json
{
  "sources": [
    {
      "type": "hackernews",
      "storyTypes": ["top", "best"],
      "limit": 30,
      "includeComments": true,
      "commentLimit": 5,
      "commentDepth": 1,
      "timeoutMs": 20000,
      "retries": 3
    }
  ],
  "analysis": {
    "profile": "forecast",
    "targetLanguage": "zh-CN",
    "depth": "standard",
    "focus": [
      "technology adoption",
      "economic impact",
      "second-order effects"
    ]
  },
  "selection": {
    "maxItems": 8,
    "minScore": 80,
    "keywords": ["AI", "database", "cloud", "open source"]
  },
  "dedupe": {
    "windowHours": 72,
    "seen": []
  },
  "output": {
    "format": "channel_message",
    "maxCharacters": 3500,
    "includeSources": true
  }
}
```

## Options

For OpenAI-compatible providers:

```json
{
  "apiKey": "provider-api-key",
  "baseUrl": "https://provider.example.com/v1",
  "model": "provider-model",
  "temperature": 0.2,
  "maxTokens": 1800
}
```

The same values can be supplied under `input.ai` or `input.analysis.ai`. Runtime secrets are also supported:

- `context.secrets.INTELLIGENCE_API_KEY`
- `context.secrets.DEXPS_API_KEY`
- `context.secrets.OPENAI_API_KEY`
- `context.env.DEXPS_BASE_URL`
- `context.env.OPENAI_BASE_URL`

## Upstream Package Input

The package can consume the output of `@maitask/hackernews-crawler` directly:

```json
{
  "analysis": {
    "profile": "economic",
    "targetLanguage": "zh-CN"
  },
  "selection": {
    "maxItems": 5,
    "minComments": 20
  }
}
```

When the workflow passes the crawler result as upstream input, `data.stories` is detected automatically.

## Deduplication State

Packages are stateless. Cross-run deduplication requires passing prior state into `dedupe.seen` and storing `data.nextDedupeState` after each run.

```json
{
  "dedupe": {
    "windowHours": 72,
    "seen": [
      {
        "key": "hackernews:123456",
        "seenAt": "2026-07-09T00:00:00Z"
      }
    ]
  }
}
```

## Telegram Delivery

Use a Plane Telegram output adapter rather than embedding bot credentials in package input.

Adapter configuration:

```json
{
  "bot_token": "telegram-bot-token",
  "chat_id": "-1000000000000",
  "parse_mode": "none",
  "disable_web_page_preview": true,
  "include_result": true,
  "max_chars": 3900
}
```

In a workflow, connect the `@maitask/intelligence-briefing` node to an Adapter node that references the saved Telegram adapter.

## Return Envelope

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "index": 0,
        "id": "hackernews:123456",
        "data": {
          "story": {},
          "insight": {}
        },
        "metadata": {
          "source": "hackernews",
          "signal": "high"
        },
        "citation_ids": ["source-1"]
      }
    ],
    "summary": {
      "total": 1,
      "success_count": 1,
      "failure_count": 0,
      "metrics": {
        "profile": "forecast",
        "targetLanguage": "zh-CN"
      }
    },
    "briefing": {
      "title": "string",
      "profile": "forecast",
      "language": "zh-CN",
      "summary": "string",
      "items": [],
      "message": "bot-ready text"
    },
    "message": "bot-ready text",
    "nextDedupeState": {
      "generatedAt": "2026-07-09T00:00:00.000Z",
      "windowHours": 72,
      "seen": []
    }
  },
  "error": null,
  "metadata": {
    "contract_version": "2026-06-27",
    "package": "@maitask/intelligence-briefing",
    "version": "0.1.2"
  },
  "citations": []
}
```

## Notes

- The `extractive` provider is available for deterministic smoke tests and no-key previews.
- Use OpenAI-compatible analysis for production translation, impact assessment, and forecast profiles.
- Set source `timeoutMs` and `retries` for live network sources that may return transient transport failures.
- The package does not store Telegram, DingTalk, Feishu, Discord, or Slack credentials.
