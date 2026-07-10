export type TelegramJsonPrimitive = string | number | boolean | null;

export type TelegramJsonValue =
  | TelegramJsonPrimitive
  | TelegramJsonValue[]
  | { [key: string]: TelegramJsonValue };

export interface TelegramMessageInput {
  text?: string;
  fileUrl?: string;
  caption?: string;
}

export type TelegramInput = string | TelegramMessageInput;

export type TelegramMessageType = 'text' | 'photo' | 'document';

export type TelegramParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

export interface TelegramOptions {
  baseUrl?: string;
  botToken?: string;
  chatId: string | number;
  messageType?: TelegramMessageType;
  parseMode?: TelegramParseMode;
  replyToMessageId?: number;
  disableNotification?: boolean;
  disableWebPagePreview?: boolean;
  replyMarkup?: { [key: string]: TelegramJsonValue };
  timeoutMs?: number;
}

export interface TelegramSecrets {
  TELEGRAM_BOT_TOKEN?: string;
  [key: string]: unknown;
}

export interface TelegramEnvironment {
  TELEGRAM_API_BASE_URL?: string;
  [key: string]: string | undefined;
}

export interface TelegramContext {
  secrets?: TelegramSecrets;
  env?: TelegramEnvironment;
  defaults?: Record<string, unknown>;
  workspacePath?: string;
  executionId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface TelegramDeliveryData {
  messageId: number;
  chatId: number;
  text?: string;
  caption?: string;
}

export interface TelegramMetadata {
  package: '@maitask/telegram-bot';
  version: '0.1.0';
  provider: 'telegram';
  method?: 'sendMessage' | 'sendPhoto' | 'sendDocument';
  timestamp: string;
}

export interface TelegramRetryAfterDetails {
  retryAfterSeconds: number;
}

export interface TelegramTimeoutDetails {
  timeoutMs: number;
}

export type TelegramErrorDetails = TelegramRetryAfterDetails | TelegramTimeoutDetails;

export interface TelegramError {
  message: string;
  code: 'TELEGRAM_ERROR';
  type: 'TelegramBotError';
  status?: number;
  retriable?: boolean;
  details?: TelegramErrorDetails;
}

export interface TelegramSuccess {
  success: true;
  data: TelegramDeliveryData;
  metadata: TelegramMetadata & {
    method: 'sendMessage' | 'sendPhoto' | 'sendDocument';
  };
  error?: never;
}

export interface TelegramFailure {
  success: false;
  error: TelegramError;
  metadata: TelegramMetadata & {
    method?: never;
  };
  data?: never;
}

export type TelegramResult = TelegramSuccess | TelegramFailure;

export function execute(
  input: TelegramInput,
  options: TelegramOptions,
  context?: TelegramContext
): Promise<TelegramResult>;
