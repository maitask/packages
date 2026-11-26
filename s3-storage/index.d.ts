export interface S3StorageInput {
  operation: 'list' | 'upload' | 'download' | 'delete';
  presignedUrl: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface S3StorageOptions {
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  allowPrivateHost?: boolean;
}

export interface S3StorageResult {
  success: boolean;
  data?: {
    mode: 'presigned-url';
    uploaded?: boolean;
    deleted?: boolean;
    content?: string;
    size?: number;
    prefix?: string;
    keyCount?: number;
    isTruncated?: boolean;
    nextContinuationToken?: string | null;
    objects?: Array<{
      key: string;
      size: number;
      lastModified: string | null;
      etag: string | null;
    }>;
    status: number;
  };
  error?: {
    message: string;
    code: string;
    type: string;
  };
  metadata: {
    package?: string;
    operation?: string;
    timestamp: string;
    version: string;
  };
}

export function execute(
  input: S3StorageInput,
  options?: S3StorageOptions,
  context?: Record<string, unknown>
): Promise<S3StorageResult>;
