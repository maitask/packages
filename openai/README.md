# @maitask/openai

OpenAI GPT models integration for Maitask.

## Features

- GPT-5, GPT-4, GPT-4-turbo, GPT-3.5-turbo support
- Chat completions API
- JSON mode output
- Streaming responses
- Function calling and tools
- Temperature and token control

## Installation

```bash
npm install @maitask/openai
```

## Usage

```javascript
import { execute } from '@maitask/openai';

const result = await execute(
  {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' }
    ],
    model: 'gpt-5',
    temperature: 0.7
  },
  {
    apiKey: 'your-openai-api-key'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `messages` - Array of message objects with `role` and `content`
- `model` - Model name (default: `gpt-5`)
- `temperature` - Controls randomness (0-1, default: 0.7)
- `maxTokens` - Maximum tokens to generate (default: 1000)
- `jsonMode` - Enable JSON output mode
- `stream` - Enable streaming responses
- `functions` - Function calling definitions
- `tools` - Tools definitions

### Options

- `apiKey` - OpenAI API key (required)
- `baseUrl` - OpenAI-compatible API base URL (default: `https://api.openai.com/v1`)
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

`options.baseUrl` has the highest endpoint precedence. Runtime may provide
`context.env.OPENAI_API_BASE_URL` as the fallback for a compatible gateway or a
controlled upstream. The official OpenAI URL remains the production default.
Repository regression uses a loopback fixture and never requires live OpenAI
availability; credentialed live smoke checks are optional diagnostics.
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

## Return Envelope

```json
{
  "success": true,
  "data": {
    "content": "model output",
    "finishReason": "stop",
    "model": "gpt-5",
    "usage": {
      "promptTokens": 12,
      "completionTokens": 34,
      "totalTokens": 46
    }
  },
  "metadata": {
    "package": "@maitask/openai",
    "version": "0.1.0",
    "provider": "openai",
    "model": "gpt-5",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

## Examples

### JSON Mode

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'List 3 colors in JSON' }],
    jsonMode: true
  },
  { apiKey: 'sk-...' }
);
```

### Function Calling

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'What is the weather?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { location: { type: 'string' } } }
      }
    }]
  },
  { apiKey: 'sk-...' }
);
```

## License

MIT
