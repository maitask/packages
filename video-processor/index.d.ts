/**
 * @maitask/video-processor TypeScript definitions
 */

export interface ExecuteInput {
    /** URL of video file to process */
    videoUrl?: string;
    /** Base64 encoded video data */
    videoData?: string;
    /** Processing task */
    task?: 'describe' | 'analyze' | 'transcribe' | 'summarize' | 'detect';
    /** Custom analysis prompt */
    prompt?: string;
    /** AI provider */
    provider?: 'openai' | 'gemini';
    /** Model name */
    model?: string;
    /** Video MIME type */
    mimeType?: string;
    videoMimeType?: string;
    /** Sample frames per second */
    frameRate?: number;
    /** Temperature for generation */
    temperature?: number;
    /** Maximum output tokens */
    maxTokens?: number;
    maxOutputTokens?: number;
    max_tokens?: number;
}

export interface ExecuteOptions {
    /** AI API key */
    apiKey?: string;
    api_key?: string;
    /** Other provider-specific options */
    [key: string]: any;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface VideoAnalysisResult {
    /** Video analysis text */
    analysis: string;
    /** Token usage (OpenAI) */
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    /** Raw API response */
    raw: any;
}

export interface ExecuteResult {
    success: boolean;
    data?: VideoAnalysisResult;
    error?: {
        message: string;
        code: string;
        type: string;
    };
    metadata: {
        provider?: string;
        model?: string;
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
