# @maitask/audio-processor

Audio processing and transcription using AI models for Maitask.

## Features

- Speech-to-text transcription (OpenAI Whisper)
- Audio translation to English
- Audio analysis and summarization (Gemini 2.5)
- Text-to-speech generation (OpenAI TTS)
- Multiple audio format support (MP3, WAV, M4A, etc.)
- Timestamp and word-level alignment
- Multi-language support (99+ languages)

## Installation

```bash
npm install @maitask/audio-processor
```

## Usage

```javascript
import { execute } from '@maitask/audio-processor';

// Transcribe audio
const result = await execute(
  {
    audioUrl: 'https://example.com/audio.mp3',
    task: 'transcribe',
    language: 'en',
    provider: 'whisper'
  },
  {
    apiKey: 'your-openai-api-key'
  }
);

console.log(result.data.text);
```

## Configuration

### Input Parameters

- `audioUrl` - URL of audio file to process
- `audioData` - Base64 encoded audio data (alternative to URL)
- `task` - Processing task (default: `transcribe`)
  - `transcribe` - Speech to text
  - `translate` - Translate audio to English
  - `analyze` - Audio analysis (Gemini)
  - `summarize` - Summarize audio content
  - `generate` - Text to speech (TTS)
- `provider` - AI provider (default: `whisper`)
  - `whisper` - OpenAI Whisper API
  - `gemini` - Gemini 2.5 native audio
  - `openai` - OpenAI (Whisper or TTS)
  - `index-tts` - Index-TTS open-source (self-hosted)
- `model` - Model name (provider-dependent)
- `language` - Audio language code (ISO 639-1)
- `prompt` - Custom prompt for analysis or context for transcription

### Options

- `apiKey` - API key for the selected provider
- `baseUrl` - Base URL for self-hosted services (Index-TTS)

## Examples

### Basic Transcription

```javascript
const result = await execute(
  {
    audioUrl: 'https://example.com/meeting.mp3',
    task: 'transcribe',
    provider: 'whisper'
  },
  { apiKey: 'sk-...' }
);

console.log(result.data.text);
console.log(result.data.language); // Detected language
```

### Transcription with Timestamps

```javascript
const result = await execute(
  {
    audioUrl: 'https://example.com/interview.mp3',
    task: 'transcribe',
    provider: 'whisper',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment']
  },
  { apiKey: 'sk-...' }
);

// Access word-level timestamps
result.data.words.forEach(word => {
  console.log(`${word.word}: ${word.start}s - ${word.end}s`);
});
```

### Translation to English

```javascript
const result = await execute(
  {
    audioUrl: 'https://example.com/french-audio.mp3',
    task: 'translate',
    provider: 'whisper'
  },
  { apiKey: 'sk-...' }
);

// Audio is transcribed and translated to English
console.log(result.data.text);
```

### Audio Analysis with Gemini

```javascript
const result = await execute(
  {
    audioData: base64AudioData,
    task: 'analyze',
    provider: 'gemini',
    prompt: 'Analyze the speaker\'s tone, emotion, and speaking style'
  },
  { apiKey: 'your-google-api-key' }
);

console.log(result.data.analysis);
```

### Text-to-Speech Generation

```javascript
// Using standard TTS model
const result = await execute(
  {
    text: 'Hello, this is a test of the text to speech system.',
    task: 'generate',
    provider: 'openai',
    voice: 'alloy',
    model: 'tts-1-hd',
    response_format: 'mp3',
    speed: 1.0
  },
  { apiKey: 'sk-...' }
);

// Get generated audio as base64
const audioBase64 = result.data.audioData;
```

### Advanced TTS with Instruction (2025 New Feature)

```javascript
// Using gpt-4o-mini-tts with instruction-based customization
const result = await execute(
  {
    text: 'Thank you for contacting our support team.',
    task: 'generate',
    provider: 'openai',
    voice: 'marin',
    model: 'gpt-4o-mini-tts',
    instruction: 'Speak in a sympathetic and helpful customer service tone',
    response_format: 'mp3'
  },
  { apiKey: 'sk-...' }
);
```

### Audio Summarization

```javascript
const result = await execute(
  {
    audioUrl: 'https://example.com/podcast.mp3',
    task: 'summarize',
    provider: 'gemini'
  },
  { apiKey: 'your-google-api-key' }
);

console.log(result.data.analysis); // Summary of podcast
```

### With Base64 Audio

```javascript
const result = await execute(
  {
    audioData: 'base64-encoded-audio-data',
    task: 'transcribe',
    language: 'es',
    provider: 'whisper'
  },
  { apiKey: 'sk-...' }
);
```

## Supported Audio Formats

- MP3
- MP4/M4A
- WAV
- MPEG
- MPGA
- WEBM
- OGG/OGA

## Supported Languages (Whisper)

99+ languages including English, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Russian, Portuguese, and many more.

## TTS Models (OpenAI)

### Available Models

- `tts-1` - Standard quality, faster generation
- `tts-1-hd` - High definition audio quality (recommended)
- `gpt-4o-mini-tts` - **New 2025 model** with instruction-based customization

### TTS Voices

**Standard Voices (all models):**

- `alloy` - Neutral, balanced voice
- `echo` - Clear, expressive voice
- `fable` - Warm, friendly voice
- `onyx` - Deep, authoritative voice
- `nova` - Energetic, upbeat voice
- `shimmer` - Soft, gentle voice

**New 2025 Voices (enhanced naturalness):**

- `marin` - Most natural-sounding, conversational
- `cedar` - Professional, clear articulation

### Instruction-Based Customization (gpt-4o-mini-tts only)

Control **how** the voice speaks using natural language instructions:

```javascript
instruction: 'Speak enthusiastically like a sports announcer'
instruction: 'Talk in a calm and reassuring tone'
instruction: 'Sound professional and confident'
instruction: 'Speak slowly and clearly for educational content'
```

## Index-TTS (Open-Source, Self-Hosted)

### About Index-TTS

Index-TTS is an industrial-level controllable and efficient zero-shot TTS system developed by bilibili, with exceptional performance for **Chinese language** scenarios.

### Key Features

- **Zero-Shot Voice Cloning**: Clone any voice with just a few seconds of reference audio
- **Emotion Control** (IndexTTS-2): Generate emotionally expressive speech
- **Duration Control**: Precise or automatic speech duration generation
- **Pinyin Support**: Pronunciation control for Chinese text
- **Multilingual**: Supports Chinese, English, and other languages
- **High Naturalness**: Superior audio quality and naturalness

### Setup

1. Clone and install Index-TTS:

```bash
git clone https://github.com/index-tts/index-tts
cd index-tts
# Follow installation instructions in the repository
```

2. Start the API server (example):

```bash
python -m index_tts.server --host 127.0.0.1 --port 8000
```

### Usage Examples

#### Basic Chinese TTS

```javascript
const result = await execute(
  {
    text: '你好，欢迎使用 Index-TTS 语音合成系统。',
    task: 'generate',
    provider: 'index-tts',
    language: 'zh'
  },
  { baseUrl: 'http://localhost:8000' }
);
```

#### Voice Cloning

```javascript
const result = await execute(
  {
    text: 'This is a cloned voice speaking.',
    task: 'generate',
    provider: 'index-tts',
    referenceAudio: base64AudioData, // 3-10 seconds of reference audio
    language: 'en'
  },
  { baseUrl: 'http://localhost:8000' }
);
```

#### Emotion Control (IndexTTS-2)

```javascript
const result = await execute(
  {
    text: '今天天气真好！',
    task: 'generate',
    provider: 'index-tts',
    emotion: 'happy',
    language: 'zh'
  },
  { baseUrl: 'http://localhost:8000' }
);
```

#### Pronunciation Control with Pinyin

```javascript
const result = await execute(
  {
    text: '重庆',
    task: 'generate',
    provider: 'index-tts',
    pinyin: 'chong2 qing4', // Specify exact pronunciation
    language: 'zh'
  },
  { baseUrl: 'http://localhost:8000' }
);
```

#### Duration Control

```javascript
const result = await execute(
  {
    text: 'Precise duration control example.',
    task: 'generate',
    provider: 'index-tts',
    durationControl: 'precise',
    speed: 1.2
  },
  { baseUrl: 'http://localhost:8000' }
);
```

### Advantages

- **Free & Open Source**: No API costs
- **Privacy**: Self-hosted, data stays on your server
- **Chinese Optimized**: Best-in-class for Chinese TTS
- **Customizable**: Full control over the model and parameters
- **No Rate Limits**: Process as much as your hardware allows

### GitHub Repository

<https://github.com/index-tts/index-tts>

## License

MIT
