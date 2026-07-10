/**
 * @maitask/kafka-publisher
 * Publish messages to Kafka using REST proxy endpoints
 *
 * @version 0.1.0
 * @license MIT
 */

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const proxyUrl = readProxyUrl(readPreferredValue(payload, options, 'proxyUrl'));
    const topic = readRequiredString(payload.topic, 'topic');
    const timeout = readPreferredValue(payload, options, 'timeoutMs');
    const timeoutMs = readTimeout(timeout.value, timeout.present);

    const messages = Array.isArray(payload.messages) ? payload.messages : [payload.messages];
    const filtered = messages.filter(item => item != null);
    if (filtered.length === 0) {
      throw new Error('messages must contain at least one entry');
    }

    const records = filtered.map(item => ({
      key: payload.key == null ? null : String(payload.key),
      value: typeof item === 'string' ? item : JSON.stringify(item)
    }));

    const response = await fetchJson(joinUrl(proxyUrl, `/topics/${encodeURIComponent(topic)}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.kafka.json.v2+json',
        ...asHeaders(payload.headers)
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
      throw new Error(data?.message || data?.error?.message || text || `Request failed with status ${response.status}`);
    }

    return data == null ? {} : data;
  } catch (error) {
    if (error.name === 'AbortError') {
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
  const headers = {};
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

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('input must be an object');
  }
  return value;
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
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(`${key} is required`);
  return text;
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
  assertSafeObjectProperties(response, new Set(['offsets']));

  const offsetsDescriptor = Object.getOwnPropertyDescriptor(response, 'offsets');
  if (!isDataDescriptor(offsetsDescriptor) || !Array.isArray(offsetsDescriptor.value)) {
    throw malformedResponseError();
  }

  return offsetsDescriptor.value.map(normalizeOffset);
}

function normalizeOffset(entry) {
  if (!isPlainObject(entry)) throw malformedResponseError();
  assertSafeObjectProperties(entry, new Set(['partition', 'offset', 'error_code', 'error']));

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

function assertSafeObjectProperties(object, knownFields) {
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== 'string') throw malformedResponseError();
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!isDataDescriptor(descriptor)) throw malformedResponseError();
    if (!knownFields.has(key) && descriptor.value !== null && typeof descriptor.value === 'object') {
      throw malformedResponseError();
    }
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

function buildError(error, code, type) {
  return {
    success: false,
    error: {
      message: error?.message || 'Unknown error',
      code,
      type
    },
    metadata: {
      timestamp: new Date().toISOString(),
      version: '0.1.0'
    }
  };
}
