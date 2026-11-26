export interface ImageGeneratorInput {
  prompt: string;
  provider?: 'openai' | 'stability';
  model?: string;
  size?: string;
  width?: number;
  height?: number;
  n?: number;
  apiKey?: string;
  timeoutMs?: number;
}

export interface ImageGeneratorOptions {
  provider?: 'openai' | 'stability';
  apiKey?: string;
  timeoutMs?: number;
}

export interface ImageGeneratorResult {
  success: boolean;
  data?: {
    provider: 'openai' | 'stability';
    prompt: string;
    model?: string;
    size?: string;
    width?: number;
    height?: number;
    count: number;
    images: Array<{
      url?: string | null;
      b64?: string | null;
      revisedPrompt?: string | null;
      finishReason?: string | null;
      seed?: number | null;
    }>;
  };
  error?: {
    message: string;
    code: string;
    type: string;
  };
  metadata: {
    package?: string;
    timestamp: string;
    version: string;
  };
}

export function execute(
  input: ImageGeneratorInput,
  options?: ImageGeneratorOptions,
  context?: { secrets?: Record<string, string> }
): Promise<ImageGeneratorResult>;
