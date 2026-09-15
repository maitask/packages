# @maitask/audio-processor

Speech-to-text, translation, audio analysis, and speech synthesis through documented provider APIs.

Supported providers:

- OpenAI Whisper (`/v1/audio/transcriptions` and `/v1/audio/translations`)
- OpenAI speech (`/v1/audio/speech`)
- Gemini `generateContent` with inline audio

## Input

- `audioUrl` or `audioData` — source audio for transcription, translation, or analysis
- `text` or `prompt` — source text for speech generation
- `task` — `transcribe`, `translate`, `analyze`, `summarize`, or `generate`
- `provider` — `whisper`, `openai`, or `gemini`
- `model`, `language`, `voice`, `prompt` — provider-specific fields

## Options

- `apiKey` — provider credential
- `mimeType` — inline audio MIME type for Gemini

Missing credentials or unsupported provider/task combinations return `success: false`.
