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
    role: 'user' | 'assistant';
    content: string;
}

export interface ExecuteInput {
    contents?: Content[];
    text?: string;
    prompt?: string;
    messages?: Message[];
    model?: string;
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

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    GOOGLE_API_KEY?: string;
    model?: string;
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
        provider: string;
        timestamp: string;
        version: string;
        model: string;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
