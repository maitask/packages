# @maitask/deepseek

DeepSeek V3.2 AI models integration for Maitask.

## Features

- DeepSeek Chat and Reasoner models
- Chain-of-thought reasoning mode
- OpenAI-compatible API
- Streaming responses
- Advanced reasoning capabilities
- Cost-effective inference
- Fill-in-the-middle (FIM) support

## Installation

```bash
npm install @maitask/deepseek
```

## Usage

```javascript
import { execute } from '@maitask/deepseek';

const result = await execute(
  {
    messages: [
      { role: 'user', content: 'Solve this problem: If x + 5 = 12, what is x?' }
    ],
    model: 'deepseek-chat'
  },
  {
    apiKey: 'your-deepseek-api-key'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `messages` - Array of message objects with `role` and `content`
- `model` - Model name (default: `deepseek-chat`)
  - `deepseek-chat` - General-purpose chat model
  - `deepseek-reasoner` - Advanced reasoning model
- `temperature` - Controls randomness (0-1, default: 0.7)
- `maxTokens` - Maximum tokens to generate (default: 1000)
- `stream` - Enable streaming responses

### Options

- `apiKey` - DeepSeek API key (required)
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

## Return Envelope

```json
{
  "success": true,
  "data": {
    "content": "final answer",
    "reasoningContent": "optional reasoning stream",
    "finishReason": "stop",
    "model": "deepseek-chat",
    "usage": {
      "promptTokens": 10,
      "completionTokens": 80,
      "totalTokens": 90
    }
  },
  "metadata": {
    "package": "@maitask/deepseek",
    "version": "0.1.0",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

## Examples

### Using Chat Model

```javascript
const result = await execute(
  {
    messages: [{ role: 'user', content: 'Explain neural networks' }],
    model: 'deepseek-chat',
    temperature: 0.8
  },
  { apiKey: 'sk-...' }
);
```

### Using Reasoner Model with Chain-of-Thought

```javascript
const result = await execute(
  {
    messages: [{
      role: 'user',
      content: 'A farmer has 17 sheep. All but 9 die. How many are left?'
    }],
    model: 'deepseek-reasoner'
  },
  { apiKey: 'sk-...' }
);

// Reasoner model includes reasoningContent showing thought process
console.log(result.data.reasoningContent);
console.log(result.data.content);
```

### Code Completion

```javascript
const result = await execute(
  {
    messages: [{
      role: 'user',
      content: 'Complete this function:\nfunction fibonacci(n) {\n  // TODO\n}'
    }],
    model: 'deepseek-chat',
    temperature: 0.2
  },
  { apiKey: 'sk-...' }
);
```

## License

MIT
