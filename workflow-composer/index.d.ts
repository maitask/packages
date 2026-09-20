export interface CatalogEntry {
  name: string;
  version?: string;
  description?: string;
  category?: string;
  input_fields?: string[];
  option_fields?: string[];
}

export interface ExecuteInput {
  description?: string;
  prompt?: string;
  goal?: string;
  language?: 'zh-CN' | 'en';
  catalog?: CatalogEntry[];
}

export interface ExecuteOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: 'zh-CN' | 'en';
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  catalog?: CatalogEntry[];
}

export function execute(
  input?: ExecuteInput,
  options?: ExecuteOptions,
  context?: Record<string, unknown>
): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: { message: string; code: string; type: string } | null;
  metadata: Record<string, unknown>;
  citations: unknown[];
}>;
