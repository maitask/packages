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
