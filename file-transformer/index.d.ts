export interface FileTransformerInput {
  data: unknown;
  from: 'json' | 'csv' | 'xml' | 'yaml' | 'toml';
  to: 'json' | 'csv' | 'xml' | 'yaml' | 'toml';
  options?: FileTransformerOptions;
}

export interface FileTransformerOptions {
  csvDelimiter?: string;
  csvQuote?: string;
  csvHeader?: boolean;
  headers?: string[];
  inferTypes?: boolean;
  includeParsed?: boolean;
  xmlRootName?: string;
  xmlItemName?: string;
  xmlDeclaration?: boolean;
  yamlIndent?: number;
}

export interface FileTransformerResult {
  success: boolean;
  data?: {
    from: string;
    to: string;
    output: string;
    parsed?: unknown;
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
  input: FileTransformerInput,
  options?: FileTransformerOptions,
  context?: Record<string, unknown>
): Promise<FileTransformerResult>;
