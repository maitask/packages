/**
 * @maitask/deepseek TypeScript definitions
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
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
    stream?: boolean;
    stop?: string | string[];
    jsonMode?: boolean;
    json_mode?: boolean;
    functions?: any[];
    function_call?: any;
    tools?: any[];
    tool_choice?: any;
}

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    DEEPSEEK_API_KEY?: string;
    model?: string;
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
    stream?: boolean;
    stop?: string | string[];
    jsonMode?: boolean;
    json_mode?: boolean;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface UsageInfo {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens: number;
    promptCacheMissTokens: number;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        content: string;
        reasoningContent: string | null;
        finishReason: string;
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
        model: string;
        reasoningMode: boolean;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
