export type CfProxyMethod = 'GET' | 'HEAD';

export type CfProxyErrorCode =
  | 'CF_PROXY_VALIDATION'
  | 'CF_PROXY_DENIED'
  | 'CF_PROXY_TIMEOUT'
  | 'CF_PROXY_RESPONSE_TOO_LARGE'
  | 'CF_PROXY_REDIRECT'
  | 'CF_PROXY_AUTH'
  | 'CF_PROXY_UPSTREAM';

export interface CfProxyConfig {
  readonly allowedHosts?: readonly string[];
  readonly allowedAuthHosts?: readonly string[];
  readonly dockerRegistryHosts?: readonly string[];
  readonly restrictPaths?: boolean;
  readonly allowedPaths?: readonly string[];
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowPrivateHosts?: boolean;
}

export interface CfProxyInput {
  readonly url: string;
  readonly method?: CfProxyMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly config?: CfProxyConfig;
}

export type CfProxyOptions = Readonly<Record<string, never>>;
export type CfProxyContext = Readonly<Record<string, unknown>>;

export interface CfProxyResponseData {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBase64: string;
  readonly bodyEncoding: 'base64';
  readonly bodyBytes: number;
  readonly isDockerRequest: boolean;
}

export interface CfProxySuccessMetadata {
  readonly package: '@maitask/cf-proxy';
  readonly version: string;
  readonly redirects: number;
  readonly registryAuthenticated: boolean;
  readonly timestamp: string;
}

export interface CfProxyFailureMetadata {
  readonly package: '@maitask/cf-proxy';
  readonly version: string;
  readonly timestamp: string;
}

export interface CfProxyError {
  readonly message: string;
  readonly code: CfProxyErrorCode;
  readonly type:
    | 'ValidationError'
    | 'PolicyError'
    | 'TimeoutError'
    | 'ResponseLimitError'
    | 'RedirectError'
    | 'AuthenticationError'
    | 'UpstreamError';
}

export interface CfProxySuccess {
  readonly success: true;
  readonly data: CfProxyResponseData;
  readonly metadata: CfProxySuccessMetadata;
}

export interface CfProxyFailure {
  readonly success: false;
  readonly error: CfProxyError;
  readonly metadata: CfProxyFailureMetadata;
}

export type CfProxyResult = CfProxySuccess | CfProxyFailure;

export function execute(
  input: CfProxyInput,
  options?: CfProxyOptions,
  context?: CfProxyContext
): Promise<CfProxyResult>;
