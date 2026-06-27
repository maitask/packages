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
    const proxyUrl = readRequiredString(payload.proxyUrl || options.proxyUrl, 'proxyUrl');
    const topic = readRequiredString(payload.topic, 'topic');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

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

    return {
      success: true,
      data: {
        topic,
        count: records.length,
        offsets: Array.isArray(response.offsets) ? response.offsets : []
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

function readRequiredString(value, key) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 30000;
  return Math.min(timeout, 120000);
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
