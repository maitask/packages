export interface GraphQLClientInput {
  url: string;
  query: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface GraphQLClientOptions {
  allowInsecureHttp?: boolean;
  allowPrivateHosts?: boolean;
  tokenSecret?: string;
  secrets?: Record<string, string>;
  timeoutMs?: number;
}

export interface GraphQLClientResult {
  success: boolean;
  data?: {
    data: unknown;
    errors: unknown[];
    extensions: unknown;
  };
  error?: {
    message: string;
    code: string;
    type: string;
  };
  metadata: {
    package?: string;
    url?: string;
    timestamp: string;
    version: string;
  };
}

export function execute(
  input: GraphQLClientInput,
  options?: GraphQLClientOptions,
  context?: { secrets?: Record<string, string>; [key: string]: unknown }
): Promise<GraphQLClientResult>;
