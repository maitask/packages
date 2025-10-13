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

## Installation

```bash
npm install @maitask/ollama
```

## Usage

```javascript
import { execute } from '@maitask/ollama';

const result = await execute(
  {
    messages: [
      { role: 'user', content: 'Explain quantum computing in simple terms' }
    ],
    model: 'llama3.1'
  },
  {
    baseUrl: 'http://localhost:11434'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `messages` - Array of message objects with `role` and `content`
- `model` - Model name (default: `llama3.1`)
- `temperature` - Controls randomness (0-1)
- `maxTokens` - Maximum tokens to generate
- `stream` - Enable streaming responses
- `system` - System prompt

### Options

- `baseUrl` - Ollama server URL (default: `http://localhost:11434`)
- `openaiCompat` - Use OpenAI-compatible endpoint (default: `false`)

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
    messages: [{ role: 'user', content: 'What is recursion?' }],
    model: 'llama3.1',
    system: 'You are a patient computer science teacher.'
  },
  { baseUrl: 'http://localhost:11434' }
);
```

## License

MIT
