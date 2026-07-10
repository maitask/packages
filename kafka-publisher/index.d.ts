export type KafkaJsonPrimitive = string | number | boolean | null;

export type KafkaJsonValue =
  | KafkaJsonPrimitive
  | readonly KafkaJsonValue[]
  | { readonly [key: string]: KafkaJsonValue };

export type KafkaMessage = KafkaJsonValue;

export type KafkaHeaderValue = KafkaJsonValue;

export interface KafkaHeaders {
  readonly [name: string]: KafkaHeaderValue;
}

export interface KafkaInput {
  readonly topic: string;
  readonly messages: KafkaMessage | readonly KafkaMessage[];
  readonly key?: KafkaJsonValue;
  readonly headers?: KafkaHeaders;
  readonly proxyUrl?: string;
  readonly timeoutMs?: number;
}

export interface KafkaOptions {
  readonly proxyUrl?: string;
  readonly timeoutMs?: number;
}

/** Opaque Runtime context accepted by the package but not inspected. */
export interface KafkaContext {
  readonly [key: string]: unknown;
}

export type KafkaOffset =
  | {
      readonly partition: number;
      readonly offset: number;
      readonly errorCode?: never;
      readonly error?: never;
    }
  | {
      readonly partition: number;
      readonly offset?: number;
      readonly errorCode: number;
      readonly error: string;
    };

export interface KafkaDeliveryData {
  readonly topic: string;
  readonly count: number;
  readonly offsets: readonly KafkaOffset[];
}

export interface KafkaSuccessMetadata {
  readonly proxyUrl: string;
  readonly timestamp: string;
  readonly version: '0.1.0';
}

export interface KafkaFailureMetadata {
  readonly timestamp: string;
  readonly version: '0.1.0';
}

export type KafkaMetadata = KafkaSuccessMetadata | KafkaFailureMetadata;

export interface KafkaError {
  readonly message: string;
  readonly code: 'KAFKA_PUBLISHER_ERROR';
  readonly type: 'KafkaPublisherError';
}

export interface KafkaSuccess {
  readonly success: true;
  readonly data: KafkaDeliveryData;
  readonly metadata: KafkaSuccessMetadata;
  readonly error?: never;
}

export interface KafkaFailure {
  readonly success: false;
  readonly error: KafkaError;
  readonly metadata: KafkaFailureMetadata;
  readonly data?: never;
}

export type KafkaResult = KafkaSuccess | KafkaFailure;

export function execute(
  input: KafkaInput,
  options?: KafkaOptions,
  context?: KafkaContext
): Promise<KafkaResult>;
