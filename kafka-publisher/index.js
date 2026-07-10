/**
 * @maitask/kafka-publisher
 * Publish messages to Kafka using REST proxy endpoints
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = snapshotContainer(input, 'input');
    const settings = snapshotContainer(options, 'options');
    const proxyUrl = readProxyUrl(readPreferredValue(payload, settings, 'proxyUrl'));
    const topic = readRequiredString(payload.topic, 'topic');
    const timeout = readPreferredValue(payload, settings, 'timeoutMs');
    const timeoutMs = readTimeout(timeout.value, timeout.present);
    const messageData = Object.hasOwn(payload, 'messages')
      ? snapshotJson(payload.messages, 'messages')
      : undefined;
    const keyData = Object.hasOwn(payload, 'key')
      ? snapshotJson(payload.key, 'key')
      : undefined;
    const headerData = Object.hasOwn(payload, 'headers')
      ? snapshotJson(payload.headers, 'headers')
      : undefined;

    const messages = Array.isArray(messageData) ? messageData : [messageData];
    const filtered = messages.filter(item => item != null);
    if (filtered.length === 0) {
      throw new Error('messages must contain at least one entry');
    }

    const records = filtered.map(item => ({
      key: keyData == null ? null : String(keyData),
      value: typeof item === 'string' ? item : JSON.stringify(item)
    }));

    const response = await fetchJson(joinUrl(proxyUrl, `/topics/${encodeURIComponent(topic)}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.kafka.json.v2+json',
        ...asHeaders(headerData)
      },
      body: { records },
      timeoutMs
    });
    const offsets = normalizeOffsets(response);

    return {
      success: true,
      data: {
        topic,
        count: records.length,
        offsets
      },
      metadata: {
        proxyUrl,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'KAFKA_PUBLISHER_ERROR', 'KafkaPublisherError');
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

async function fetchJson(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    const data = tryParseJson(text);

    if (!response.ok) {
      throw new Error(readHttpErrorMessage(data, response.status));
    }

    return data == null ? {} : data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, '')}${suffix}`;
}

function asHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const headers = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    headers[key] = String(item);
  }
  return headers;
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function snapshotContainer(value, field) {
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be a plain object`);
  }

  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new Error(`${field} must not contain symbol properties`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isDataDescriptor(descriptor)) {
      throw new Error(`${field}.${key} must be an own data property`);
    }
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
  return snapshot;
}

function snapshotJson(value, field, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} must contain finite JSON numbers`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${field} must contain only JSON values`);
  }
  if (active.has(value)) throw new Error(`${field} must not contain cycles`);

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`${field} arrays must use the standard Array prototype`);
      }
      return snapshotJsonArray(value, field, active);
    }
    if (!isPlainObject(value)) {
      throw new Error(`${field} must contain only plain JSON objects`);
    }
    return snapshotJsonObject(value, field, active);
  } finally {
    active.delete(value);
  }
}

function snapshotJsonArray(value, field, active) {
  const allowedKeys = new Set(['length']);
  for (let index = 0; index < value.length; index += 1) {
    allowedKeys.add(String(index));
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new Error(`${field} must not contain array symbols or extra properties`);
    }
  }

  const snapshot = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isDataDescriptor(descriptor)) {
      throw new Error(`${field}[${index}] must be an own data property`);
    }
    snapshot[index] = snapshotJson(descriptor.value, `${field}[${index}]`, active);
  }
  return snapshot;
}

function snapshotJsonObject(value, field, active) {
  const snapshot = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new Error(`${field} must not contain symbol properties`);
    }
    if (key === 'toJSON') {
      throw new Error(`${field}.toJSON is not supported`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isDataDescriptor(descriptor)) {
      throw new Error(`${field}.${key} must be an own data property`);
    }
    Object.defineProperty(snapshot, key, {
      value: snapshotJson(descriptor.value, `${field}.${key}`, active),
      enumerable: descriptor.enumerable,
      configurable: true,
      writable: true
    });
  }
  return snapshot;
}

function readPreferredValue(input, options, key) {
  if (Object.hasOwn(input, key)) {
    return { present: true, value: input[key] };
  }
  if (options != null && Object.hasOwn(options, key)) {
    return { present: true, value: options[key] };
  }
  return { present: false, value: undefined };
}

function readProxyUrl(selection) {
  if (!selection.present || typeof selection.value !== 'string' || !selection.value.trim()) {
    throw new Error('proxyUrl is required and must be a non-empty string');
  }
  return selection.value.trim();
}

function readRequiredString(value, key) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

function readTimeout(value, present) {
  if (!present) return 30000;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('timeoutMs must be a finite positive number');
  }
  return Math.min(value, 120000);
}

function normalizeOffsets(response) {
  if (!isPlainObject(response)) throw malformedResponseError();
  assertOwnDataProperties(response);

  const offsetsDescriptor = Object.getOwnPropertyDescriptor(response, 'offsets');
  if (!isDataDescriptor(offsetsDescriptor) || !Array.isArray(offsetsDescriptor.value)) {
    throw malformedResponseError();
  }

  return readOffsetEntries(offsetsDescriptor.value).map(normalizeOffset);
}

function readOffsetEntries(offsets) {
  if (Object.getPrototypeOf(offsets) !== Array.prototype) throw malformedResponseError();

  const descriptors = new Map();
  let length;
  for (const key of Reflect.ownKeys(offsets)) {
    if (typeof key !== 'string') throw malformedResponseError();
    const descriptor = Object.getOwnPropertyDescriptor(offsets, key);
    if (!isDataDescriptor(descriptor)) throw malformedResponseError();
    if (key === 'length') {
      length = descriptor.value;
    } else {
      descriptors.set(key, descriptor);
    }
  }
  if (!Number.isSafeInteger(length) || length < 0) throw malformedResponseError();
  for (const key of descriptors.keys()) {
    if (!isArrayIndex(key, length)) throw malformedResponseError();
  }

  const entries = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors.get(String(index));
    if (!descriptor) throw malformedResponseError();
    entries[index] = descriptor.value;
  }
  return entries;
}

function isArrayIndex(key, length) {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function normalizeOffset(entry) {
  if (!isPlainObject(entry)) throw malformedResponseError();
  assertOwnDataProperties(entry);

  const partition = readDataProperty(entry, 'partition');
  if (!partition.present || !isNonNegativeSafeInteger(partition.value)) {
    throw malformedResponseError();
  }

  const offset = readDataProperty(entry, 'offset');
  if (offset.present && !isNonNegativeSafeInteger(offset.value)) {
    throw malformedResponseError();
  }

  const errorCode = readDataProperty(entry, 'error_code');
  const error = readDataProperty(entry, 'error');
  if (errorCode.present !== error.present) throw malformedResponseError();
  if (errorCode.present && (!Number.isInteger(errorCode.value) || typeof error.value !== 'string')) {
    throw malformedResponseError();
  }
  if (!offset.present && !errorCode.present) throw malformedResponseError();

  const normalized = { partition: partition.value };
  if (offset.present) normalized.offset = offset.value;
  if (errorCode.present) {
    normalized.errorCode = errorCode.value;
    normalized.error = error.value;
  }
  return normalized;
}

function assertOwnDataProperties(object) {
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== 'string') throw malformedResponseError();
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!isDataDescriptor(descriptor)) throw malformedResponseError();
  }
}

function readDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) return { present: false, value: undefined };
  if (!isDataDescriptor(descriptor)) throw malformedResponseError();
  return { present: true, value: descriptor.value };
}

function isDataDescriptor(descriptor) {
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function malformedResponseError() {
  return new Error('Kafka REST proxy returned a malformed response');
}

function readHttpErrorMessage(data, status) {
  const fallback = `Request failed with status ${status}`;
  if (!isPlainObject(data) || !hasOnlyOwnDataProperties(data)) return fallback;

  const message = Object.getOwnPropertyDescriptor(data, 'message');
  if (message !== undefined) {
    return isDataDescriptor(message) && typeof message.value === 'string'
      ? message.value
      : fallback;
  }

  const error = Object.getOwnPropertyDescriptor(data, 'error');
  if (!isDataDescriptor(error) || !isPlainObject(error.value)) return fallback;
  if (!hasOnlyOwnDataProperties(error.value)) return fallback;
  const nestedMessage = Object.getOwnPropertyDescriptor(error.value, 'message');
  return isDataDescriptor(nestedMessage) && typeof nestedMessage.value === 'string'
    ? nestedMessage.value
    : fallback;
}

function hasOnlyOwnDataProperties(value) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    if (!isDataDescriptor(Object.getOwnPropertyDescriptor(value, key))) return false;
  }
  return true;
}

function safeErrorMessage(error) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
  return isDataDescriptor(descriptor) && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function buildError(error, code, type) {
  return {
    success: false,
    error: {
      message: safeErrorMessage(error) ?? 'Unknown error',
      code,
      type
    },
    metadata: {
      timestamp: new Date().toISOString(),
      version: '0.1.0'
    }
  };
}
