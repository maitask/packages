/**
 * @maitask/text-summary TypeScript definitions
 */

export interface ExecuteInput {
    text: string | string[];
    model?: string;
    provider?: 'openai' | 'claude' | 'gemini';
    style?: 'concise' | 'detailed' | 'bullet';
    maxLength?: number;
    max_length?: number;
    language?: string;
}

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    provider?: 'openai' | 'claude' | 'gemini';
    model?: string;
    style?: 'concise' | 'detailed' | 'bullet';
    maxLength?: number;
    language?: string;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        summary: string;
        wordCount: number;
        style: string;
        inputCount: number;
        raw: any;
    };
    error?: {
        message: string;
        code: string;
        type: string;
    };
    metadata: {
        provider: string;
        model: string;
        timestamp: string;
        version: string;
    };
}

export function execute(
    input: ExecuteInput,
    options?: ExecuteOptions,
    context?: ExecuteContext
): Promise<ExecuteResult>;
