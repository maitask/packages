/**
 * @maitask/claude TypeScript definitions
 */

export interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export interface ExecuteInput {
    messages?: Message[];
    model?: string;
    system?: string | any[];
    maxTokens?: number;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stream?: boolean;
    stop_sequences?: string[];
    metadata?: any;
}

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    baseUrl?: string;
    timeoutMs?: number;
    retries?: number;
    model?: string;
    system?: string | any[];
    maxTokens?: number;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stream?: boolean;
    stop_sequences?: string[];
    metadata?: any;
}

export interface ExecuteContext {
    secrets?: {
        ANTHROPIC_API_KEY?: string;
    };
    env?: {
        ANTHROPIC_API_BASE_URL?: string;
    };
    [key: string]: any;
}

export interface UsageInfo {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        content: string;
        stopReason: string;
        model: string;
        usage: UsageInfo;
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
        model?: string;
        usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
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
