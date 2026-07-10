export type SlackJsonPrimitive = string | number | boolean | null;

export type SlackJsonValue =
  | SlackJsonPrimitive
  | SlackJsonValue[]
  | SlackJsonObject;

export interface SlackJsonObject {
  [key: string]: SlackJsonValue;
}

export interface SlackTextObject extends SlackJsonObject {
  type: string;
  text: string;
}

export interface SlackBlock extends SlackJsonObject {
  type: string;
}

export interface SlackAttachment extends SlackJsonObject {}

export interface SlackMessageInput {
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

export type SlackInput = string | SlackMessageInput;

export interface SlackOptions {
  webhookUrl?: string;
  threadTs?: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
  iconUrl?: string;
  linkNames?: boolean;
  mrkdwn?: boolean;
  timeoutMs?: number;
}

export interface SlackSecrets {
  SLACK_WEBHOOK_URL?: string;
}

export interface SlackContext {
  secrets?: SlackSecrets;
}

export interface SlackDeliveryData {
  webhook: string;
  username: string;
  icon?: string;
  channel?: string;
  threadTs?: string;
  hasBlocks: boolean;
  hasAttachments: boolean;
}

export interface SlackSuccessMetadata {
  package: '@maitask/slack-notifier';
  version: '0.1.0';
  provider: 'slack';
  webhook: string;
  responseStatus: number;
  responseTimeMs: number;
  timestamp: string;
}

export interface SlackFailureMetadata {
  package: '@maitask/slack-notifier';
  version: '0.1.0';
  provider: 'slack';
  webhook: string | null;
  timestamp: string;
}

export interface SlackRetryAfterDetails {
  retryAfterSeconds: number;
}

export interface SlackTimeoutDetails {
  timeoutMs: number;
}

export type SlackErrorDetails = SlackRetryAfterDetails | SlackTimeoutDetails;

export interface SlackError {
  message: string;
  code: 'SLACK_ERROR';
  type: 'SlackNotificationError';
  status?: number;
  retriable?: boolean;
  details?: SlackErrorDetails;
}

export interface SlackSuccess {
  success: true;
  data: SlackDeliveryData;
  metadata: SlackSuccessMetadata;
  error?: never;
}

export interface SlackFailure {
  success: false;
  error: SlackError;
  metadata: SlackFailureMetadata;
  data?: never;
}

export type SlackResult = SlackSuccess | SlackFailure;

export function execute(
  input: SlackInput,
  options?: SlackOptions,
  context?: SlackContext
): Promise<SlackResult>;
