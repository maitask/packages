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
    ANTHROPIC_API_KEY?: string;
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
        provider: string;
        timestamp: string;
        version: string;
        model?: string;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
