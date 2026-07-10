export type SlackJsonPrimitive = string | number | boolean | null;

export type SlackJsonValue =
  | SlackJsonPrimitive
  | readonly SlackJsonValue[]
  | SlackJsonObject;

export interface SlackJsonObject {
  readonly [key: string]: SlackJsonValue;
}

export interface SlackTextObject extends SlackJsonObject {
  readonly type: string;
  readonly text: string;
}

export interface SlackBlock extends SlackJsonObject {
  readonly type: string;
}

export interface SlackAttachment extends SlackJsonObject {}

export interface SlackMessageInput {
  readonly text?: string;
  readonly blocks?: readonly SlackBlock[];
  readonly attachments?: readonly SlackAttachment[];
}

export type SlackInput = string | SlackMessageInput;

export interface SlackOptions {
  readonly webhookUrl?: string;
  readonly threadTs?: string;
  readonly channel?: string;
  readonly username?: string;
  readonly iconEmoji?: string;
  readonly iconUrl?: string;
  readonly linkNames?: boolean;
  readonly mrkdwn?: boolean;
  readonly timeoutMs?: number;
}

export interface SlackSecrets {
  readonly SLACK_WEBHOOK_URL?: string;
}

export interface SlackContext {
  readonly secrets?: SlackSecrets;
}

export interface SlackDeliveryData {
  readonly webhook: string;
  readonly username: string;
  readonly icon?: string;
  readonly channel?: string;
  readonly threadTs?: string;
  readonly hasBlocks: boolean;
  readonly hasAttachments: boolean;
}

export interface SlackSuccessMetadata {
  readonly package: '@maitask/slack-notifier';
  readonly version: '0.1.0';
  readonly provider: 'slack';
  readonly webhook: string;
  readonly responseStatus: number;
  readonly responseTimeMs: number;
  readonly timestamp: string;
}

export interface SlackFailureMetadata {
  readonly package: '@maitask/slack-notifier';
  readonly version: '0.1.0';
  readonly provider: 'slack';
  readonly webhook: string | null;
  readonly timestamp: string;
}

export interface SlackRetryAfterDetails {
  readonly retryAfterSeconds: number;
}

export interface SlackTimeoutDetails {
  readonly timeoutMs: number;
}

export type SlackErrorDetails = SlackRetryAfterDetails | SlackTimeoutDetails;

export interface SlackError {
  readonly message: string;
  readonly code: 'SLACK_ERROR';
  readonly type: 'SlackNotificationError';
  readonly status?: number;
  readonly retriable?: boolean;
  readonly details?: SlackErrorDetails;
}

export interface SlackSuccess {
  readonly success: true;
  readonly data: SlackDeliveryData;
  readonly metadata: SlackSuccessMetadata;
  readonly error?: never;
}

export interface SlackFailure {
  readonly success: false;
  readonly error: SlackError;
  readonly metadata: SlackFailureMetadata;
  readonly data?: never;
}

export type SlackResult = SlackSuccess | SlackFailure;

export function execute(
  input: SlackInput,
  options?: SlackOptions,
  context?: SlackContext
): Promise<SlackResult>;
