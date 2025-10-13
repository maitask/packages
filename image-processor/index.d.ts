/**
 * @maitask/image-processor TypeScript definitions
 */

export interface ExecuteInput {
    imageUrl?: string | string[];
    imageData?: string;
    task?: 'describe' | 'ocr' | 'detect' | 'custom';
    prompt?: string;
    model?: string;
    provider?: 'openai' | 'claude' | 'gemini';
}

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    provider?: 'openai' | 'claude' | 'gemini';
    model?: string;
    task?: 'describe' | 'ocr' | 'detect' | 'custom';
    prompt?: string;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        analysis: string;
        task: string;
        imageCount: number;
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
