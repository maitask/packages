# @maitask/text-summary

Text summarization using AI models for Maitask.

## Features

- Multi-provider support (OpenAI, Claude, Gemini, Ollama, DeepSeek)
- Multiple summary styles (concise, detailed, bullet-points)
- Custom summary length control
- Key points extraction
- Multi-language support
- Long document handling

## Installation

```bash
npm install @maitask/text-summary
```

## Usage

```javascript
import { execute } from '@maitask/text-summary';

const result = await execute(
  {
    text: 'Long article text here...',
    style: 'concise',
    provider: 'openai'
  },
  {
    apiKey: 'your-api-key'
  }
);

console.log(result.data.summary);
```

## Configuration

### Input Parameters

- `text` - Text to summarize (required)
- `provider` - AI provider (default: `openai`)
  - `openai` - Uses GPT-5
  - `claude` - Uses Claude Sonnet 4.5
  - `gemini` - Uses Gemini 2.5 Pro
  - `ollama` - Uses local models
  - `deepseek` - Uses DeepSeek Chat
- `model` - Specific model to use (provider-dependent)
- `style` - Summary style (default: `concise`)
  - `concise` - Brief summary (1-2 sentences)
  - `detailed` - Comprehensive summary
  - `bullet` - Bullet-point key points
- `maxLength` - Maximum summary length in words
- `language` - Target language for summary (default: same as input)

### Options

- `apiKey` - API key for the selected provider
- Provider-specific options (baseUrl for Ollama, etc.)

## Examples

### Concise Summary

```javascript
const result = await execute(
  {
    text: 'Artificial intelligence (AI) is intelligence demonstrated by machines... [long text]',
    style: 'concise',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);

// Output: "AI refers to machine intelligence capable of learning and problem-solving,
// with applications across multiple industries."
```

### Detailed Summary

```javascript
const result = await execute(
  {
    text: 'Climate change is a long-term shift in global... [long article]',
    style: 'detailed',
    maxLength: 200,
    provider: 'claude'
  },
  { apiKey: 'sk-ant-...' }
);

// Returns comprehensive summary with main points and context
```

### Bullet-Point Summary

```javascript
const result = await execute(
  {
    text: 'The quarterly earnings report shows... [financial report]',
    style: 'bullet',
    provider: 'gemini'
  },
  { apiKey: 'your-key' }
);

// Output:
// "• Revenue increased 15% year-over-year
//  • Operating expenses reduced by 8%
//  • Net profit margin improved to 22%
//  • Strong growth in cloud services division"
```

### Using Local Models (Ollama)

```javascript
const result = await execute(
  {
    text: 'Long research paper text...',
    style: 'detailed',
    provider: 'ollama',
    model: 'mistral'
  },
  { baseUrl: 'http://localhost:11434' }
);
```

### Multi-language Summary

```javascript
const result = await execute(
  {
    text: 'English article text...',
    style: 'concise',
    language: 'zh',  // Summarize in Chinese
    provider: 'deepseek'
  },
  { apiKey: 'sk-...' }
);
```

## License

MIT
