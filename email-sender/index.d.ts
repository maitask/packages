export type EmailProvider = 'sendgrid' | 'mailgun';
export type EmailJsonPrimitive = string | number | boolean | null;
export type EmailJsonValue =
  | EmailJsonPrimitive
  | readonly EmailJsonValue[]
  | { readonly [key: string]: EmailJsonValue };

export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export type EmailDirectContent =
  | { readonly text: string; readonly html?: string }
  | { readonly text?: string; readonly html: string };

export type EmailLocalTemplate = (
  | { readonly text: string; readonly html?: string }
  | { readonly text?: string; readonly html: string }
) & {
  readonly variables?: Readonly<Record<string, EmailJsonValue>>;
};

export interface EmailProviderTemplate {
  readonly id: string;
  readonly variables?: Readonly<Record<string, EmailJsonValue>>;
}

export interface EmailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly bodyBase64: string;
  readonly disposition?: 'attachment' | 'inline';
  readonly contentId?: string;
}

export type EmailMessageHeaders = Readonly<Record<`X-${string}`, string>> & {
  readonly 'X-SMTPAPI'?: never;
  readonly 'X-Mailgun-Variables'?: never;
};

interface EmailMessageCommon {
  readonly from: EmailAddress;
  readonly to?: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly bcc?: readonly EmailAddress[];
  readonly replyTo?: EmailAddress;
  readonly attachments?: readonly EmailAttachment[];
  readonly headers?: EmailMessageHeaders;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

interface EmailDirectMessage extends EmailMessageCommon {
  readonly subject: string;
  readonly content: EmailDirectContent;
  readonly template?: never;
  readonly providerTemplate?: never;
}

interface EmailLocalTemplateMessage extends EmailMessageCommon {
  readonly subject: string;
  readonly content?: never;
  readonly template: EmailLocalTemplate;
  readonly providerTemplate?: never;
}

interface EmailProviderTemplateMessage extends EmailMessageCommon {
  readonly subject?: string;
  readonly content?: never;
  readonly template?: never;
  readonly providerTemplate: EmailProviderTemplate;
}

export type EmailMessage =
  | EmailDirectMessage
  | EmailLocalTemplateMessage
  | EmailProviderTemplateMessage;

export type SendGridEmailInput = EmailMessage & { readonly provider: 'sendgrid' };
export type MailgunEmailInput = EmailMessage & { readonly provider: 'mailgun' };
export type EmailSenderInput = SendGridEmailInput | MailgunEmailInput;

interface EmailProviderOptionsCommon {
  readonly baseUrl?: string;
  readonly apiKeySecret?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface SendGridEmailOptions extends EmailProviderOptionsCommon {
  readonly domain?: never;
}

export interface MailgunEmailOptions extends EmailProviderOptionsCommon {
  readonly domain: string;
}

export interface EmailSenderContext {
  readonly secrets?: Readonly<Record<string, string>>;
  readonly executionId?: string;
  readonly [key: string]: unknown;
}

export interface EmailDeliveryReceipt {
  readonly provider: EmailProvider;
  readonly messageId: string | null;
  readonly status: number;
  readonly recipientCount: number;
  readonly hasText: boolean;
  readonly hasHtml: boolean;
  readonly attachmentCount: number;
  readonly templateMode: 'none' | 'local' | 'provider';
}

export interface EmailDeliveryItem {
  readonly index: 0;
  readonly id?: string;
  readonly data: EmailDeliveryReceipt;
}

export interface EmailDeliverySummary {
  readonly total: 1;
  readonly success_count: 1;
  readonly failure_count: 0;
}

export interface EmailSuccessMetadata {
  readonly contractVersion: string;
  readonly package: '@maitask/email-sender';
  readonly version: string;
  readonly provider: EmailProvider;
  readonly executionId: string | null;
  readonly status: number;
  readonly attempts: 1;
  readonly executedAt: string;
  readonly executionMs: number;
}

export interface EmailFailureMetadata {
  readonly contractVersion: string;
  readonly package: '@maitask/email-sender';
  readonly version: string;
  readonly provider: EmailProvider | null;
  readonly executionId: string | null;
  readonly attempts: 0 | 1;
  readonly executedAt: string;
  readonly executionMs: number;
}

export type EmailErrorCode =
  | 'EMAIL_VALIDATION'
  | 'EMAIL_SECRET_UNAVAILABLE'
  | 'EMAIL_POLICY'
  | 'EMAIL_TIMEOUT'
  | 'EMAIL_RESPONSE_TOO_LARGE'
  | 'EMAIL_REDIRECT'
  | 'EMAIL_PROVIDER'
  | 'EMAIL_UPSTREAM';

export interface EmailError {
  readonly message: string;
  readonly code: EmailErrorCode;
  readonly type:
    | 'ValidationError'
    | 'SecretUnavailableError'
    | 'PolicyError'
    | 'TimeoutError'
    | 'ResponseLimitError'
    | 'RedirectError'
    | 'ProviderError'
    | 'UpstreamError';
  readonly status?: number;
  readonly retriable?: boolean;
}

export interface EmailSuccess {
  readonly success: true;
  readonly data: {
    readonly items: readonly [EmailDeliveryItem];
    readonly summary: EmailDeliverySummary;
  };
  readonly error: null;
  readonly metadata: EmailSuccessMetadata;
  readonly citations: readonly [];
}

export interface EmailFailureResult {
  readonly success: false;
  readonly error: EmailError;
  readonly metadata: EmailFailureMetadata;
  readonly citations: readonly [];
}

export type EmailResult = EmailSuccess | EmailFailureResult;

export function execute(
  input: SendGridEmailInput,
  options?: SendGridEmailOptions,
  context?: EmailSenderContext
): Promise<EmailResult>;

export function execute(
  input: MailgunEmailInput,
  options: MailgunEmailOptions,
  context?: EmailSenderContext
): Promise<EmailResult>;
