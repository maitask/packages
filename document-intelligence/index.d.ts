export interface DocumentInput {
  title?: string;
  text?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ExecuteInput {
  text?: string;
  title?: string;
  url?: string;
  documents?: DocumentInput[];
  items?: unknown[];
  data?: { items?: unknown[] };
  task?: 'summarize' | 'classify' | 'extract';
  language?: 'zh-CN' | 'en';
  labels?: string[];
}

export interface ExecuteOptions {
  task?: 'summarize' | 'classify' | 'extract';
  language?: 'zh-CN' | 'en';
  labels?: string[];
  schema?: Record<string, unknown>;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  ai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  output?: {
    includeSources?: boolean;
    maxCharacters?: number;
  };
}

export interface ExecuteContext {
  secrets?: Record<string, string | undefined>;
  execution_id?: string;
  [key: string]: unknown;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function execute(
  input?: ExecuteInput,
  options?: ExecuteOptions,
  context?: ExecuteContext
): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: { message: string; code: string; type: string } | null;
  metadata: Record<string, unknown>;
  citations: Array<{ id: string; title: string; url: string | null }>;
}>;
