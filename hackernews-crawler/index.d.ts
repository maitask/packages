export interface MaitaskPackageContext {
  secrets?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  defaults?: Record<string, unknown>;
  workspace_path?: string;
  execution_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface MaitaskPackageError {
  message: string;
  code: string;
  type: string;
  details?: unknown;
}

export interface MaitaskPackageItem<T = unknown> {
  index: number;
  id?: string | number;
  data: T;
  metadata?: Record<string, unknown>;
  citation_ids?: string[];
}

export interface MaitaskPackageSummary {
  total: number;
  success_count: number;
  failure_count: number;
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MaitaskPackageData<T = unknown> {
  items?: Array<MaitaskPackageItem<T>>;
  summary?: MaitaskPackageSummary;
  [key: string]: unknown;
}

export interface MaitaskPackageResult<T = unknown> {
  success: boolean;
  data?: MaitaskPackageData<T> | T;
  error?: MaitaskPackageError | null;
  metadata?: Record<string, unknown>;
  citations?: unknown[];
  [key: string]: unknown;
}

export function execute(
  input?: unknown,
  options?: Record<string, unknown>,
  context?: MaitaskPackageContext
): MaitaskPackageResult | Promise<MaitaskPackageResult>;
