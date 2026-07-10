export type KafkaJsonPrimitive = string | number | boolean | null;

export type KafkaJsonValue =
  | KafkaJsonPrimitive
  | KafkaJsonValue[]
  | { [key: string]: KafkaJsonValue };

export type KafkaMessage = KafkaJsonValue;

export type KafkaHeaderValue = KafkaJsonValue;

export interface KafkaHeaders {
  [name: string]: KafkaHeaderValue;
}

export interface KafkaInput {
  topic: string;
  messages: KafkaMessage | KafkaMessage[];
  key?: KafkaJsonValue;
  headers?: KafkaHeaders;
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface KafkaOptions {
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface KafkaContext {
  [key: string]: unknown;
}

export interface KafkaOffset {
  partition?: number;
  offset?: number;
  error_code?: number;
  error?: string;
  [key: string]: KafkaJsonValue | undefined;
}

export interface KafkaDeliveryData {
  topic: string;
  count: number;
  offsets: KafkaOffset[];
}

export interface KafkaSuccessMetadata {
  proxyUrl: string;
  timestamp: string;
  version: '0.1.0';
}

export interface KafkaFailureMetadata {
  timestamp: string;
  version: '0.1.0';
}

export type KafkaMetadata = KafkaSuccessMetadata | KafkaFailureMetadata;

export interface KafkaError {
  message: string;
  code: 'KAFKA_PUBLISHER_ERROR';
  type: 'KafkaPublisherError';
}

export interface KafkaSuccess {
  success: true;
  data: KafkaDeliveryData;
  metadata: KafkaSuccessMetadata;
  error?: never;
}

export interface KafkaFailure {
  success: false;
  error: KafkaError;
  metadata: KafkaFailureMetadata;
  data?: never;
}

export type KafkaResult = KafkaSuccess | KafkaFailure;

export function execute(
  input: KafkaInput,
  options?: KafkaOptions,
  context?: KafkaContext
): Promise<KafkaResult>;
