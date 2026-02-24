# @maitask/claude

Anthropic Claude AI models integration for Maitask.

## Features

- Claude Sonnet 4.5, Claude Opus 4.1, Claude 3.5 Sonnet support
- Messages API
- System prompts
- Multimodal inputs (text + images)
- Streaming responses
- Temperature and token control

## Installation

```bash
npm install @maitask/claude
```

## Usage

```javascript
import { execute } from '@maitask/claude';

const result = await execute(
  {
    messages: [
      { role: 'user', content: 'Hello, Claude!' }
    ],
    model: 'claude-sonnet-4-5',
    maxTokens: 1024,
    system: 'You are a helpful assistant.'
  },
  {
    apiKey: 'your-anthropic-api-key'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `messages` - Array of message objects with `role` ('user' or 'assistant') and `content`
- `model` - Model name (default: `claude-sonnet-4-5`)
- `maxTokens` - Maximum tokens to generate (required)
- `system` - System prompt (separate from messages)
- `temperature` - Controls randomness (0-1)
- `stream` - Enable streaming responses

### Options

- `apiKey` - Anthropic API key (required)
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

## Return Envelope

```json
{
  "success": true,
  "data": {
    "content": "model output",
    "stopReason": "end_turn",
    "model": "claude-sonnet-4-5",
    "usage": {
      "inputTokens": 20,
      "outputTokens": 80,
      "totalTokens": 100
    }
  },
  "metadata": {
    "package": "@maitask/claude",
    "version": "0.1.0",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

## Examples

### With System Prompt

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'Explain quantum computing' }],
    maxTokens: 2048,
    system: 'You are a physics professor.'
  },
  { apiKey: 'sk-ant-...' }
);
```

### Multimodal (Image + Text)

```javascript
const result = await execute(
  {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: '...'
          }
        }
      ]
    }],
    maxTokens: 1024
  },
  { apiKey: 'sk-ant-...' }
);

// Or with URL (will be fetched and converted to base64)
const result2 = await execute(
  {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this image' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/image.jpg' } }
      ]
    }],
    maxTokens: 1024
  },
  { apiKey: 'sk-ant-...' }
);
```

## License

MIT
