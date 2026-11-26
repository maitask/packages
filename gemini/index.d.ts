/**
 * @maitask/gemini TypeScript definitions
 */

export interface ContentPart {
    text?: string;
    inlineData?: {
        mimeType: string;
        data: string;
    };
}

export interface Content {
    role?: 'user' | 'model';
    parts: ContentPart[];
}

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'model';
    content: string;
}

export interface ExecuteInput {
    contents?: Content[];
    text?: string;
    prompt?: string;
    system?: string;
    messages?: Message[];
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    max_tokens?: number;
    topP?: number;
    top_p?: number;
    topK?: number;
    top_k?: number;
    stream?: boolean;
    stopSequences?: string[];
    responseMimeType?: string;
    safetySettings?: any[];
    systemInstruction?: any;
}

export interface ExecuteOptions {
    apiKey?: string;
    baseUrl?: string;
    allowPrivateHosts?: boolean;
    allowInsecureHttp?: boolean;
    timeoutMs?: number;
    retries?: number;
    model?: string;
    stream?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    max_tokens?: number;
    topP?: number;
    top_p?: number;
    topK?: number;
    top_k?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    safetySettings?: any[];
    systemInstruction?: any;
}

export interface ExecuteContext {
    secrets?: {
        GEMINI_API_KEY?: string;
        GOOGLE_API_KEY?: string;
    };
    env?: {
        GEMINI_API_BASE_URL?: string;
    };
    [key: string]: any;
}

export interface UsageInfo {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        content: string;
        finishReason: string;
        model: string;
        usage: UsageInfo;
        safetyRatings: any[];
        raw: any;
    };
    error?: {
        message: string;
        code: string;
        type: string;
    };
    metadata: {
        package?: string;
        provider: string;
        timestamp: string;
        version: string;
        model: string;
        usage?: UsageInfo & {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
