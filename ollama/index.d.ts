/**
 * @maitask/ollama TypeScript definitions
 */

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ExecuteInput {
    messages?: Message[];
    model?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    num_predict?: number;
    stream?: boolean;
    jsonMode?: boolean;
    json_mode?: boolean;
    options?: any;
}

export interface ExecuteOptions {
    baseUrl?: string;
    base_url?: string;
    openaiCompat?: boolean;
    openai_compat?: boolean;
    model?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    num_predict?: number;
    stream?: boolean;
    jsonMode?: boolean;
    json_mode?: boolean;
    options?: any;
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
        loadDuration?: number;
        totalDuration?: number;
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
        endpoint: string;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
