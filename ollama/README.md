# @maitask/ollama

Ollama local AI models integration for Maitask.

## Features

- Local model execution (Llama, Mistral, CodeLlama, etc.)
- OpenAI-compatible API support
- Native Ollama API support
- Chat and completion modes
- Streaming responses
- Custom model management
- No API key required

## Execution

Run through Maitask Runtime or invoke the CommonJS entry point locally:

```javascript
const { execute } = require('./index');

const result = await execute(
  {
    messages: [
      { role: 'user', content: 'Explain quantum computing in simple terms' }
    ],
    model: 'llama3.2'
  },
  {
    baseUrl: 'http://localhost:11434'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `messages` - Array of message objects with `role` (`'system'`, `'user'`, or `'assistant'`) and `content` (or supply `text` / `prompt`)
- `model` - Model name (default: `llama3.2`)
- `temperature` - Controls randomness (`0`–`2`, omitted unless specified)
- `max_tokens` / `num_predict` - Maximum tokens to generate (`maxTokens` also accepted in `openaiCompat` mode)
- `stream` - Enable streaming responses (default: `false`)

### Options

- `baseUrl` - Ollama server URL (default: `http://localhost:11434`; ignored if supplied in `input`)
- `openaiCompat` - Use OpenAI-compatible endpoint (default: `false`)
- `allowPrivateHosts` - Required `true` when configuring a custom private/internal `baseUrl` (default built-in `http://localhost:11434` is permitted unless set to `false`)
- `allowInsecureHttp` - Allow plain `http:` for non-localhost `baseUrl` (default: `false`)
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

The mandatory AI provider regression exercises `options.baseUrl` against a
loopback Ollama-compatible fixture for both request routing and native NDJSON
response handling. Live model availability remains an optional diagnostic and
is not required by the repository quality gate.

## Return Envelope

```json
{
  "success": true,
  "data": {
    "content": "model output",
    "finishReason": "stop",
    "model": "llama3.2",
    "usage": {
      "promptTokens": 20,
      "completionTokens": 40,
      "totalTokens": 60
    }
  },
  "metadata": {
    "package": "@maitask/ollama",
    "version": "0.1.1",
    "provider": "ollama",
    "endpoint": "native",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

## Examples

### Using Native Ollama API

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'Write a haiku about coding' }],
    model: 'mistral'
  },
  { baseUrl: 'http://localhost:11434' }
);
```

### Using OpenAI-Compatible Endpoint

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'Explain async/await' }],
    model: 'codellama'
  },
  {
    baseUrl: 'http://localhost:11434',
    openaiCompat: true
  }
);
```

### With System Prompt

```javascript
const result = await execute(
  {
    messages: [
      { role: 'system', content: 'You are a patient computer science teacher.' },
      { role: 'user', content: 'What is recursion?' }
    ],
    model: 'llama3.2'
  },
  { baseUrl: 'http://localhost:11434' }
);
```

## License

MIT
