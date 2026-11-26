/**
 * @maitask/openai TypeScript definitions
 */

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ExecuteInput {
    messages?: Message[];
    text?: string;
    prompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    jsonMode?: boolean;
    json_mode?: boolean;
    response_format?: { type?: string };
    stream?: boolean;
    functions?: any[];
    function_call?: any;
    tools?: any[];
    tool_choice?: any;
}

export interface ExecuteOptions {
    apiKey?: string;
    baseUrl?: string;
    allowPrivateHosts?: boolean;
    allowInsecureHttp?: boolean;
    timeoutMs?: number;
    retries?: number;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    jsonMode?: boolean;
    json_mode?: boolean;
    stream?: boolean;
}

export interface ExecuteContext {
    secrets?: {
        OPENAI_API_KEY?: string;
    };
    env?: {
        OPENAI_API_BASE_URL?: string;
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
