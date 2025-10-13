# @maitask/video-processor

Video analysis and processing using AI vision models for Maitask.

## Features

- Video content analysis and description
- Scene detection and object recognition
- Audio transcription from video
- Video summarization
- Action and event detection
- Multi-provider support (GPT-5, Gemini 2.5 Pro)
- Multiple video format support (MP4, MOV, AVI, WebM)

## Installation

```bash
npm install @maitask/video-processor
```

## Usage

```javascript
import { execute } from '@maitask/video-processor';

const result = await execute(
  {
    videoUrl: 'https://example.com/video.mp4',
    task: 'describe',
    provider: 'gemini'
  },
  {
    apiKey: 'your-google-api-key'
  }
);

console.log(result.data.analysis);
```

## Configuration

### Input Parameters

- `videoUrl` - URL of video file to process
- `videoData` - Base64 encoded video data (alternative to URL)
- `task` - Processing task (default: `describe`)
  - `describe` - Describe what's happening in the video
  - `analyze` - Comprehensive video analysis
  - `transcribe` - Transcribe speech from video
  - `summarize` - Summarize video content
  - `detect` - Detect objects, people, and events
- `provider` - AI provider (default: `gemini`)
  - `gemini` - Gemini 2.5 Pro (recommended for video)
  - `openai` - GPT-5
- `model` - Model name (provider-dependent)
- `prompt` - Custom analysis prompt
- `mimeType` - Video MIME type (default: `video/mp4`)

### Options

- `apiKey` - API key for the selected provider

## Examples

### Video Description

```javascript
const result = await execute(
  {
    videoUrl: 'https://example.com/presentation.mp4',
    task: 'describe',
    provider: 'gemini'
  },
  { apiKey: 'your-api-key' }
);

console.log(result.data.analysis);
// "This video shows a business presentation..."
```

### Comprehensive Video Analysis

```javascript
const result = await execute(
  {
    videoUrl: 'https://example.com/conference.mp4',
    task: 'analyze',
    provider: 'gemini',
    prompt: 'Analyze this conference video. Identify speakers, main topics discussed, audience reactions, and key visual elements like slides or demonstrations.'
  },
  { apiKey: 'your-api-key' }
);
```

### Video Transcription

```javascript
const result = await execute(
  {
    videoData: base64VideoData,
    task: 'transcribe',
    provider: 'openai',
    model: 'gpt-5'
  },
  { apiKey: 'sk-...' }
);

// Get transcript with timestamps
console.log(result.data.analysis);
```

### Video Summarization

```javascript
const result = await execute(
  {
    videoUrl: 'https://example.com/tutorial.mp4',
    task: 'summarize',
    provider: 'gemini'
  },
  { apiKey: 'your-api-key' }
);

console.log(result.data.analysis);
// "This tutorial covers the following topics: 1) Introduction to..."
```

### Object and Event Detection

```javascript
const result = await execute(
  {
    videoUrl: 'https://example.com/surveillance.mp4',
    task: 'detect',
    provider: 'gemini',
    prompt: 'Identify all people, vehicles, and significant events in this security footage. Provide timestamps for each detection.'
  },
  { apiKey: 'your-api-key' }
);
```

### Custom Analysis

```javascript
const result = await execute(
  {
    videoUrl: 'https://example.com/sports.mp4',
    prompt: 'Analyze this sports video. Identify the sport, teams/players, score changes, key plays, and highlight moments worth reviewing.',
    provider: 'openai'
  },
  { apiKey: 'sk-...' }
);
```

### Using Base64 Video Data

```javascript
const result = await execute(
  {
    videoData: 'base64-encoded-video-data',
    task: 'describe',
    mimeType: 'video/webm',
    provider: 'gemini'
  },
  { apiKey: 'your-api-key' }
);
```

## Supported Video Formats

- MP4 (H.264, H.265/HEVC)
- MOV (QuickTime)
- AVI
- WebM
- MKV
- FLV
- MPEG/MPG

## Provider Comparison

| Feature | Gemini 2.5 Pro | GPT-5 |
|---------|----------------|-------|
| Video Understanding | ✅ Excellent | ✅ Very Good |
| Audio Analysis | ✅ Native | ✅ Supported |
| Long Videos | ✅ Up to 1 hour+ | ⚠️ Depends on size |
| Frame-by-Frame | ✅ Automatic | ✅ Automatic |
| Cost | $$ | $$$ |

**Recommendation**: Use **Gemini 2.5 Pro** for most video analysis tasks due to its native multimodal capabilities and better handling of long-form video content.

## Performance Tips

1. **Video Length**: Shorter videos (< 10 minutes) process faster
2. **Resolution**: Lower resolution videos use less bandwidth
3. **Provider Selection**: Gemini 2.5 Pro generally performs better for video
4. **Specific Prompts**: Detailed prompts yield better results

## Limitations

- Maximum video file size varies by provider
- Processing time increases with video length
- Some providers may have beta access requirements for video features
- Audio quality affects transcription accuracy

## License

MIT
