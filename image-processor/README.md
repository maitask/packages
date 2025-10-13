# @maitask/image-processor

Image analysis and processing using AI vision models for Maitask.

## Features

- Multi-provider vision model support (OpenAI GPT-4V, Claude 3.5, Gemini 2.5 Pro)
- Image description and analysis
- Optical Character Recognition (OCR)
- Object detection and identification
- Scene understanding
- Multiple image format support (JPEG, PNG, WebP)
- Base64 and URL input support

## Installation

```bash
npm install @maitask/image-processor
```

## Usage

```javascript
import { execute } from '@maitask/image-processor';

const result = await execute(
  {
    image: 'base64-encoded-image-data',
    task: 'describe',
    provider: 'openai'
  },
  {
    apiKey: 'your-api-key'
  }
);

console.log(result.data.analysis);
```

## Configuration

### Input Parameters

- `image` - Image data (base64 string or URL) (required)
- `images` - Array of images for batch analysis
- `task` - Analysis task (default: `describe`)
  - `describe` - Generate detailed image description
  - `ocr` - Extract text from image
  - `detect` - Identify and list objects
  - `analyze` - Comprehensive analysis
- `provider` - AI provider (default: `openai`)
  - `openai` - Uses GPT-4V / GPT-5
  - `claude` - Uses Claude 3.5 Sonnet
  - `gemini` - Uses Gemini 2.5 Pro
- `model` - Specific model to use (provider-dependent)
- `prompt` - Custom analysis prompt
- `detail` - Image detail level for OpenAI (`low`, `high`, `auto`)

### Options

- `apiKey` - API key for the selected provider
- Provider-specific options

## Examples

### Image Description

```javascript
const result = await execute(
  {
    image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    task: 'describe',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);

// Output: "The image shows a sunset over the ocean with sailboats..."
```

### OCR Text Extraction

```javascript
const result = await execute(
  {
    image: 'https://example.com/document.jpg',
    task: 'ocr',
    provider: 'claude'
  },
  { apiKey: 'sk-ant-...' }
);

// Extracts all text from the image
```

### Object Detection

```javascript
const result = await execute(
  {
    image: 'base64-image-data',
    task: 'detect',
    provider: 'gemini'
  },
  { apiKey: 'your-key' }
);

// Output: Lists all detected objects with locations and confidence
```

### Custom Analysis Prompt

```javascript
const result = await execute(
  {
    image: 'base64-image-data',
    prompt: 'Identify the architectural style of this building and describe its key features',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);
```

### Batch Image Analysis

```javascript
const result = await execute(
  {
    images: [
      'base64-image-1',
      'base64-image-2',
      'base64-image-3'
    ],
    task: 'describe',
    provider: 'claude'
  },
  { apiKey: 'sk-ant-...' }
);

// Returns array of analysis results for each image
```

### High-Detail Analysis

```javascript
const result = await execute(
  {
    image: 'base64-image-data',
    task: 'analyze',
    detail: 'high',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);

// Comprehensive analysis with fine-grained details
```

## License

MIT
