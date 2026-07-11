export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type HttpResponseType = 'json' | 'text' | 'base64';
export type HttpRedirectMode = 'follow' | 'manual' | 'error';
export type HttpParameter = string | number | boolean;
export type HttpJsonPrimitive = string | number | boolean | null;
export type HttpJsonValue =
  | HttpJsonPrimitive
  | readonly HttpJsonValue[]
  | { readonly [key: string]: HttpJsonValue };

export type HttpRequestHeaders = Readonly<Record<string, string>> & {
  readonly Authorization?: never;
  readonly authorization?: never;
  readonly Cookie?: never;
  readonly cookie?: never;
  readonly Host?: never;
  readonly host?: never;
  readonly 'Content-Length'?: never;
  readonly 'content-length'?: never;
  readonly Connection?: never;
  readonly connection?: never;
  readonly 'Proxy-Authorization'?: never;
  readonly 'proxy-authorization'?: never;
  readonly 'Transfer-Encoding'?: never;
  readonly 'transfer-encoding'?: never;
  readonly 'User-Agent'?: never;
  readonly 'user-agent'?: never;
};

export interface HttpBearerAuthentication {
  readonly type: 'bearer';
  readonly tokenSecret: string;
}

export interface HttpBasicAuthentication {
  readonly type: 'basic';
  readonly usernameSecret: string;
  readonly passwordSecret: string;
}

export interface HttpApiKeyAuthentication {
  readonly type: 'apiKey';
  readonly header: string;
  readonly valueSecret: string;
}

export type HttpAuthentication =
  | HttpBearerAuthentication
  | HttpBasicAuthentication
  | HttpApiKeyAuthentication;

export interface HttpMultipartFile {
  readonly filename: string;
  readonly contentType?: string;
  readonly bodyBase64: string;
}

export type HttpMultipartValue = HttpParameter | HttpMultipartFile;

export interface HttpAcceptedStatusRange {
  readonly min?: number;
  readonly max?: number;
}

export interface HttpRetryPolicyBase {
  readonly statuses?: readonly number[];
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly jitterRatio?: number;
  readonly respectRetryAfter?: boolean;
}

export interface HttpSafeRetryPolicy extends HttpRetryPolicyBase {
  readonly maxAttempts?: 1 | 2 | 3 | 4 | 5;
}

export interface HttpUnsafeRetryPolicy extends HttpRetryPolicyBase {
  readonly maxAttempts?: 1;
}

interface HttpNoBody {
  readonly json?: never;
  readonly text?: never;
  readonly bodyBase64?: never;
  readonly form?: never;
  readonly multipart?: never;
}

interface HttpJsonBody {
  readonly json: HttpJsonValue;
  readonly text?: never;
  readonly bodyBase64?: never;
  readonly form?: never;
  readonly multipart?: never;
}

interface HttpTextBody {
  readonly json?: never;
  readonly text: string;
  readonly bodyBase64?: never;
  readonly form?: never;
  readonly multipart?: never;
}

interface HttpBase64Body {
  readonly json?: never;
  readonly text?: never;
  readonly bodyBase64: string;
  readonly form?: never;
  readonly multipart?: never;
}

interface HttpFormBody {
  readonly json?: never;
  readonly text?: never;
  readonly bodyBase64?: never;
  readonly form: Readonly<Record<string, HttpParameter | readonly HttpParameter[]>>;
  readonly multipart?: never;
}

interface HttpMultipartBody {
  readonly json?: never;
  readonly text?: never;
  readonly bodyBase64?: never;
  readonly form?: never;
  readonly multipart: Readonly<
    Record<string, HttpMultipartValue | readonly HttpMultipartValue[]>
  >;
}

type HttpBody =
  | HttpNoBody
  | HttpJsonBody
  | HttpTextBody
  | HttpBase64Body
  | HttpFormBody
  | HttpMultipartBody;

interface HttpRequestCommon {
  readonly url: string;
  readonly query?: Readonly<Record<string, HttpParameter | readonly HttpParameter[]>>;
  readonly headers?: HttpRequestHeaders;
  readonly auth?: HttpAuthentication;
  readonly responseType?: HttpResponseType;
  readonly acceptedStatuses?: readonly number[];
  readonly acceptedStatusRange?: never;
  readonly redirect?: HttpRedirectMode;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
}

interface HttpRangeRequestCommon extends Omit<HttpRequestCommon, 'acceptedStatuses' | 'acceptedStatusRange'> {
  readonly acceptedStatuses?: never;
  readonly acceptedStatusRange: HttpAcceptedStatusRange;
}

type HttpStatusPolicy = HttpRequestCommon | HttpRangeRequestCommon;

export type HttpReadRequestInput = HttpStatusPolicy & HttpNoBody & {
  readonly method?: 'GET' | 'HEAD';
  readonly retry?: HttpSafeRetryPolicy;
};

export type HttpOptionsRequestInput = HttpStatusPolicy & HttpBody & {
  readonly method: 'OPTIONS';
  readonly retry?: HttpSafeRetryPolicy;
};

export type HttpWriteRequestInput = HttpStatusPolicy & HttpBody & {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly retry?: HttpUnsafeRetryPolicy;
};

export type HttpRequestInput =
  | HttpReadRequestInput
  | HttpOptionsRequestInput
  | HttpWriteRequestInput;

export interface HttpRequestOptions {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
  readonly allowInsecureHttp?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface HttpRequestContext {
  readonly secrets?: Readonly<Record<string, string>>;
  readonly executionId?: string;
  readonly [key: string]: unknown;
}

export interface HttpResponseData<TBody> {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: TBody;
  readonly bodyBase64: string;
  readonly bodyBytes: number;
}

export interface HttpResponseItem<TBody> {
  readonly index: 0;
  readonly data: HttpResponseData<TBody>;
  readonly metadata: {
    readonly accepted: true;
    readonly status: number;
  };
}

export interface HttpResponseSummary {
  readonly total: 1;
  readonly success_count: 1;
  readonly failure_count: 0;
  readonly metrics: {
    readonly status: number;
  };
}

export interface HttpSuccessMetadata {
  readonly contractVersion: string;
  readonly package: '@maitask/http-request';
  readonly version: string;
  readonly executionId: string | null;
  readonly method: HttpMethod;
  readonly status: number;
  readonly attempts: number;
  readonly redirects: number;
  readonly executedAt: string;
  readonly executionMs: number;
}

export interface HttpFailureMetadata {
  readonly contractVersion: string;
  readonly package: '@maitask/http-request';
  readonly version: string;
  readonly executionId: string | null;
  readonly method: HttpMethod | null;
  readonly attempts: number;
  readonly redirects: number;
  readonly executedAt: string;
  readonly executionMs: number;
}

export type HttpRequestErrorCode =
  | 'HTTP_REQUEST_VALIDATION'
  | 'HTTP_REQUEST_SECRET_UNAVAILABLE'
  | 'HTTP_REQUEST_POLICY'
  | 'HTTP_REQUEST_TIMEOUT'
  | 'HTTP_REQUEST_RESPONSE_TOO_LARGE'
  | 'HTTP_REQUEST_REDIRECT'
  | 'HTTP_REQUEST_STATUS'
  | 'HTTP_REQUEST_RESPONSE_PARSE'
  | 'HTTP_REQUEST_UPSTREAM';

export interface HttpRequestError {
  readonly message: string;
  readonly code: HttpRequestErrorCode;
  readonly type:
    | 'ValidationError'
    | 'SecretUnavailableError'
    | 'PolicyError'
    | 'TimeoutError'
    | 'ResponseLimitError'
    | 'RedirectError'
    | 'HttpStatusError'
    | 'ResponseParseError'
    | 'UpstreamError';
  readonly status?: number;
  readonly retriable?: boolean;
}

export interface HttpRequestSuccess<TBody> {
  readonly success: true;
  readonly data: {
    readonly items: readonly [HttpResponseItem<TBody>];
    readonly summary: HttpResponseSummary;
  };
  readonly error: null;
  readonly metadata: HttpSuccessMetadata;
  readonly citations: readonly [];
}

export interface HttpRequestFailure {
  readonly success: false;
  readonly error: HttpRequestError;
  readonly metadata: HttpFailureMetadata;
  readonly citations: readonly [];
}

export type HttpRequestResult<TBody> = HttpRequestSuccess<TBody> | HttpRequestFailure;

export function execute<TJson extends HttpJsonValue = HttpJsonValue>(
  input: HttpRequestInput & { readonly responseType?: 'json' },
  options?: HttpRequestOptions,
  context?: HttpRequestContext
): Promise<HttpRequestResult<TJson | null>>;

export function execute(
  input: HttpRequestInput & { readonly responseType: 'text' },
  options?: HttpRequestOptions,
  context?: HttpRequestContext
): Promise<HttpRequestResult<string | null>>;

export function execute(
  input: HttpRequestInput & { readonly responseType: 'base64' },
  options?: HttpRequestOptions,
  context?: HttpRequestContext
): Promise<HttpRequestResult<string>>;
