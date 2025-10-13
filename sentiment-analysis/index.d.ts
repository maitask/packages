/**
 * @maitask/sentiment-analysis TypeScript definitions
 */

export interface ExecuteInput {
    text: string | string[];
    model?: string;
    provider?: 'openai' | 'claude' | 'gemini';
    detailed?: boolean;
}

export interface ExecuteOptions {
    apiKey?: string;
    api_key?: string;
    provider?: 'openai' | 'claude' | 'gemini';
    model?: string;
    detailed?: boolean;
}

export interface ExecuteContext {
    [key: string]: any;
}

export interface SentimentAnalysis {
    sentiment: 'positive' | 'negative' | 'neutral';
    confidence: number;
    emotions?: string[];
    aspects?: any[];
    reasoning?: string;
}

export interface ExecuteResult {
    success: boolean;
    data?: {
        analysis: SentimentAnalysis | SentimentAnalysis[];
        inputCount: number;
        detailed: boolean;
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
