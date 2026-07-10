# @maitask/gemini

Google Gemini AI models integration for Maitask.

## Features

- Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite support
- Generate content API
- Structured output
- Multimodal inputs (text + images)
- Streaming generation
- Safety settings

## Installation

```bash
npm install @maitask/gemini
```

## Usage

```javascript
import { execute } from '@maitask/gemini';

const result = await execute(
  {
    text: 'Explain how AI works',
    model: 'gemini-2.5-pro'
  },
  {
    apiKey: 'your-google-api-key'
  }
);

console.log(result.data.content);
```

## Configuration

### Input Parameters

- `text` / `prompt` - Simple text input
- `contents` - Advanced content array with parts
- `messages` - Chat messages (converted to Gemini format)
- `model` - Model name (default: `gemini-2.5-pro`)
- `temperature` - Controls randomness (0-1)
- `maxOutputTokens` - Maximum tokens to generate
- `responseMimeType` - Output MIME type for structured output

### Options

- `apiKey` - Google AI API key (required)
- `baseUrl` - Gemini-compatible models API base URL (default: `https://generativelanguage.googleapis.com/v1beta/models`)
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

`options.baseUrl` has the highest endpoint precedence. Runtime may provide
`context.env.GEMINI_API_BASE_URL` as the fallback for a compatible gateway or a
controlled upstream. The official Google Generative Language URL remains the
production default. Repository regression uses a loopback fixture and never
requires live Gemini availability; credentialed live smoke checks are optional
diagnostics.
- `timeoutMs` - Request timeout in milliseconds (default: `60000`)
- `retries` - Retry count for transient failures (default: `2`)

## Return Envelope

```json
{
  "success": true,
  "data": {
    "content": "model output",
    "finishReason": "STOP",
    "model": "gemini-2.5-pro",
    "usage": {
      "promptTokens": 10,
      "completionTokens": 50,
      "totalTokens": 60
    }
  },
  "metadata": {
    "package": "@maitask/gemini",
    "version": "0.1.0",
    "provider": "google",
    "model": "gemini-2.5-pro",
    "timestamp": "2026-02-24T00:00:00.000Z"
  }
}
```

## Examples

### Simple Text

```javascript
const result = await execute(
  {
    text: 'What is quantum computing?',
    maxOutputTokens: 1000
  },
  { apiKey: 'your-api-key' }
);
```

### Chat Format

```javascript
const result = await execute(
  {
    messages: [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' }
    ]
  },
  { apiKey: 'your-api-key' }
);
```

### Multimodal (Image + Text)

```javascript
// Using contents with inline image data
const result = await execute(
  {
    contents: [{
      parts: [
        { text: 'Describe this image' },
        { inlineData: { mimeType: 'image/jpeg', data: base64ImageData } }
      ]
    }]
  },
  { apiKey: 'your-api-key' }
);

// Or using messages format with multimodal content
const result2 = await execute(
  {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', data: base64ImageData }
      ]
    }]
  },
  { apiKey: 'your-api-key' }
);
```

## License

MIT
