/**
 * @maitask/audio-processor TypeScript definitions
 */

export interface ExecuteInput {
    /** URL of audio file to process */
    audioUrl?: string;
    /** Base64 encoded audio data */
    audioData?: string;
    /** Processing task */
    task?: 'transcribe' | 'translate' | 'analyze' | 'generate' | 'summarize';
    /** Analysis or generation prompt */
    prompt?: string;
    /** Text for audio generation (TTS) */
    text?: string;
    /** Audio language (for transcription) */
    language?: string;
    /** AI provider */
    provider?: 'whisper' | 'gemini' | 'openai' | 'index-tts' | 'indextts';
    /** Model name */
    model?: string;
    /** Audio MIME type */
    mimeType?: string;
    /** Voice for TTS generation */
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'marin' | 'cedar';
    /** Response format */
    response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt' | 'mp3' | 'opus' | 'aac' | 'flac';
    /** Temperature for generation */
    temperature?: number;
    /** Speed for TTS (0.25 to 4.0) */
    speed?: number;
    /** Instruction for how to speak (gpt-4o-mini-tts only, 2025 feature) */
    instruction?: string;
    /** Reference audio for voice cloning (Index-TTS, base64 or URL) */
    referenceAudio?: string;
    reference_audio?: string;
    /** Emotion control (Index-TTS-2: happy, sad, angry, neutral, etc.) */
    emotion?: string;
    /** Duration control mode (Index-TTS-2: auto, precise) */
    durationControl?: 'auto' | 'precise';
    duration_control?: 'auto' | 'precise';
    /** Pinyin for pronunciation control (Index-TTS Chinese) */
    pinyin?: string;
    /** Timestamp granularities for Whisper */
    timestamp_granularities?: ('word' | 'segment')[];
}

export interface ExecuteOptions {
    /** AI API key */
    apiKey?: string;
    api_key?: string;
    /** Base URL for self-hosted services (Index-TTS) */
    baseUrl?: string;
    base_url?: string;
    /** Other provider-specific options */
    [key: string]: any;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface WhisperResult {
    /** Transcribed text */
    text: string;
    /** Detected language */
    language?: string;
    /** Audio duration in seconds */
    duration?: number;
    /** Segments with timestamps */
    segments?: Array<{
        id: number;
        seek: number;
        start: number;
        end: number;
        text: string;
        tokens: number[];
        temperature: number;
        avg_logprob: number;
        compression_ratio: number;
        no_speech_prob: number;
    }>;
    /** Word-level timestamps */
    words?: Array<{
        word: string;
        start: number;
        end: number;
    }>;
    /** Raw API response */
    raw: any;
}

export interface GeminiAudioResult {
    /** Audio analysis text */
    analysis: string;
    /** Raw API response */
    raw: any;
}

export interface TTSResult {
    /** Generated audio as base64 */
    audioData: string;
    /** Audio format */
    format: string;
    /** Model used */
    model: string;
    /** Voice used */
    voice: string;
}

export interface ExecuteResult {
    success: boolean;
    data?: WhisperResult | GeminiAudioResult | TTSResult;
    error?: {
        message: string;
        code: string;
        type: string;
    };
    metadata: {
        provider?: string;
        task?: string;
        timestamp: string;
        version: string;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
