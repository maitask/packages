export type TelegramJsonPrimitive = string | number | boolean | null;

export type TelegramJsonValue =
  | TelegramJsonPrimitive
  | readonly TelegramJsonValue[]
  | { readonly [key: string]: TelegramJsonValue };

export interface TelegramMessageInput {
  readonly text?: string;
  readonly fileUrl?: string;
  readonly caption?: string;
}

export type TelegramInput = string | TelegramMessageInput;

export type TelegramMessageType = 'text' | 'photo' | 'document';

export type TelegramParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

export interface TelegramOptions {
  readonly baseUrl?: string;
  readonly botToken?: string;
  readonly chatId: string | number;
  readonly messageType?: TelegramMessageType;
  readonly parseMode?: TelegramParseMode;
  readonly replyToMessageId?: number;
  readonly disableNotification?: boolean;
  readonly disableWebPagePreview?: boolean;
  readonly replyMarkup?: { readonly [key: string]: TelegramJsonValue };
  readonly timeoutMs?: number;
}

export interface TelegramSecrets {
  readonly TELEGRAM_BOT_TOKEN?: string;
}

export interface TelegramEnvironment {
  readonly TELEGRAM_API_BASE_URL?: string;
}

export interface TelegramContext {
  readonly secrets?: TelegramSecrets;
  readonly env?: TelegramEnvironment;
}

export interface TelegramDeliveryData {
  readonly messageId: number;
  readonly chatId: number;
  readonly text?: string;
  readonly caption?: string;
}

export interface TelegramMetadata {
  readonly package: '@maitask/telegram-bot';
  readonly version: '0.1.0';
  readonly provider: 'telegram';
  readonly method?: 'sendMessage' | 'sendPhoto' | 'sendDocument';
  readonly timestamp: string;
}

export interface TelegramRetryAfterDetails {
  readonly retryAfterSeconds: number;
}

export interface TelegramTimeoutDetails {
  readonly timeoutMs: number;
}

export type TelegramErrorDetails = TelegramRetryAfterDetails | TelegramTimeoutDetails;

export interface TelegramError {
  readonly message: string;
  readonly code: 'TELEGRAM_ERROR';
  readonly type: 'TelegramBotError';
  readonly status?: number;
  readonly retriable?: boolean;
  readonly details?: TelegramErrorDetails;
}

export interface TelegramSuccess {
  readonly success: true;
  readonly data: TelegramDeliveryData;
  readonly metadata: TelegramMetadata & {
    readonly method: 'sendMessage' | 'sendPhoto' | 'sendDocument';
  };
  readonly error?: never;
}

export interface TelegramFailure {
  readonly success: false;
  readonly error: TelegramError;
  readonly metadata: TelegramMetadata & {
    readonly method?: never;
  };
  readonly data?: never;
}

export type TelegramResult = TelegramSuccess | TelegramFailure;

export function execute(
  input: TelegramInput,
  options: TelegramOptions,
  context?: TelegramContext
): Promise<TelegramResult>;
