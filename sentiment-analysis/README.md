# @maitask/sentiment-analysis

Text sentiment analysis using AI models for Maitask.

## Features

- Multi-provider support (OpenAI, Claude, Gemini, Ollama, DeepSeek)
- Sentiment classification (positive, negative, neutral)
- Confidence scores
- Detailed emotional insights
- Batch text analysis
- Customizable analysis depth

## Installation

```bash
npm install @maitask/sentiment-analysis
```

## Usage

```javascript
import { execute } from '@maitask/sentiment-analysis';

const result = await execute(
  {
    text: 'I absolutely love this product! It exceeded my expectations.',
    provider: 'openai'
  },
  {
    apiKey: 'your-api-key'
  }
);

console.log(result.data.sentiment);    // "positive"
console.log(result.data.confidence);   // 0.95
```

## Configuration

### Input Parameters

- `text` - Text to analyze (required)
- `texts` - Array of texts for batch analysis
- `provider` - AI provider (default: `openai`)
  - `openai` - Uses GPT-5
  - `claude` - Uses Claude Sonnet 4.5
  - `gemini` - Uses Gemini 2.5 Pro
  - `ollama` - Uses local models
  - `deepseek` - Uses DeepSeek Chat
- `model` - Specific model to use (provider-dependent)
- `detailed` - Enable detailed emotional analysis (default: `false`)
- `language` - Input text language (default: `auto-detect`)

### Options

- `apiKey` - API key for the selected provider
- Provider-specific options (baseUrl for Ollama, etc.)

## Examples

### Basic Sentiment Analysis

```javascript
const result = await execute(
  {
    text: 'The service was terrible and the staff was rude.',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);

// Output:
// {
//   sentiment: "negative",
//   confidence: 0.92,
//   score: -0.8
// }
```

### Detailed Emotional Analysis

```javascript
const result = await execute(
  {
    text: 'I am thrilled with the results, though a bit nervous about next steps.',
    provider: 'claude',
    detailed: true
  },
  { apiKey: 'sk-ant-...' }
);

// Output includes:
// {
//   sentiment: "positive",
//   confidence: 0.78,
//   emotions: {
//     joy: 0.7,
//     anxiety: 0.3,
//     excitement: 0.6
//   }
// }
```

### Batch Analysis

```javascript
const result = await execute(
  {
    texts: [
      'Great product!',
      'Not worth the price.',
      'It works as expected.'
    ],
    provider: 'gemini'
  },
  { apiKey: 'your-key' }
);

// Returns array of sentiment results
```

### Using Local Models (Ollama)

```javascript
const result = await execute(
  {
    text: 'This is amazing!',
    provider: 'ollama',
    model: 'llama3.1'
  },
  { baseUrl: 'http://localhost:11434' }
);
```

## License

MIT
