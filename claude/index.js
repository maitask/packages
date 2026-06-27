/**
 * @maitask/claude
 * Anthropic Claude integration using the Messages API.
 *
 * Production-focused behavior:
 * - Strict input normalization
 * - Timeout + retry with exponential backoff
 * - Streaming SSE aggregation
 * - Unified success/error envelope
 */

const PACKAGE_NAME = '@maitask/claude';
const PACKAGE_VERSION = '0.1.0';
const API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

async function execute(input = {}, options = {}, context = {}) {
  try {
    ensureFetch();

    const cfg = buildConfig(input, options, context);
    const requestBody = buildRequestBody(input, cfg);

    const response = await requestWithRetry(
      API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': API_VERSION
        },
        body: JSON.stringify(requestBody)
      },
      cfg.timeoutMs,
      cfg.retries
    );

    if (!response.ok) {
      return buildApiError('CLAUDE_API_ERROR', 'Claude API request failed', response, cfg);
    }

    if (cfg.stream) {
      const streamResult = await parseClaudeStream(response);
      return buildSuccess(
        {
          content: streamResult.content,
          stopReason: streamResult.stopReason,
          model: cfg.model,
          usage: streamResult.usage,
          chunks: streamResult.chunks
        },
        cfg
      );
    }

    const result = await response.json();
    const text = extractClaudeText(result.content);

    return buildSuccess(
      {
        content: text,
        stopReason: result.stop_reason || null,
        model: result.model || cfg.model,
        usage: {
          inputTokens: Number(result.usage?.input_tokens || 0),
          outputTokens: Number(result.usage?.output_tokens || 0),
          totalTokens: Number(result.usage?.input_tokens || 0) + Number(result.usage?.output_tokens || 0)
        },
        raw: result
      },
      cfg
    );
  } catch (error) {
    return buildError('CLAUDE_API_ERROR', error, {
      provider: 'anthropic'
    });
  }
}

function buildConfig(input, options, context) {
  const apiKey =
    options.apiKey || options.api_key || input.apiKey || input.api_key || context?.secrets?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is required. Provide via options.apiKey or context.secrets.ANTHROPIC_API_KEY');
  }

  return {
    apiKey,
    model: String(input.model || options.model || 'claude-sonnet-4-5').trim(),
    maxTokens: readPositiveInt(input.maxTokens ?? input.max_tokens ?? options.maxTokens ?? options.max_tokens, 1024),
    stream: Boolean(input.stream ?? options.stream ?? false),
    timeoutMs: readBoundedInt(input.timeoutMs ?? options.timeoutMs, 1000, 300000, 60000),
    retries: readBoundedInt(input.retries ?? options.retries, 0, 5, 2)
  };
}

function buildRequestBody(input, cfg) {
  const messages = normalizeMessages(input);
  if (!messages.length) {
    throw new Error('messages or text/prompt is required');
  }

  const body = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages,
    stream: cfg.stream
  };

  if (input.system !== undefined) body.system = input.system;
  if (input.temperature !== undefined) body.temperature = readNumber(input.temperature, undefined);
  if (input.top_p !== undefined) body.top_p = readNumber(input.top_p, undefined);
  if (input.top_k !== undefined) body.top_k = readNumber(input.top_k, undefined);
  if (Array.isArray(input.stop_sequences)) body.stop_sequences = input.stop_sequences;

  return body;
}

function normalizeMessages(input) {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input
      .messages
      .map((message) => {
        if (!message || typeof message !== 'object') return null;
        const role = asNonEmptyString(message.role) || 'user';
        if (typeof message.content === 'string') {
          const text = message.content.trim();
          if (!text) return null;
          return { role, content: text };
        }
        if (Array.isArray(message.content)) {
          return { role, content: message.content };
        }
        return null;
      })
      .filter(Boolean);
  }

  const text = asNonEmptyString(input.text || input.prompt);
  if (!text) return [];
  return [{ role: 'user', content: text }];
}

function extractClaudeText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((entry) => entry?.type === 'text' && typeof entry?.text === 'string')
    .map((entry) => entry.text)
    .join('');
}

async function parseClaudeStream(response) {
  const chunks = [];
  let content = '';
  let stopReason = null;
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  await parseSSE(response, (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    if (payload.type === 'message_start') {
      usage.inputTokens = Number(payload.message?.usage?.input_tokens || usage.inputTokens);
      usage.outputTokens = Number(payload.message?.usage?.output_tokens || usage.outputTokens);
      return;
    }

    if (payload.type === 'content_block_delta') {
      const text = payload.delta?.text || payload.delta?.partial_json || '';
      if (text) {
        content += text;
        chunks.push(text);
      }
      return;
    }

    if (payload.type === 'message_delta') {
      stopReason = payload.delta?.stop_reason || stopReason;
      if (payload.usage?.output_tokens !== undefined) {
        usage.outputTokens = Number(payload.usage.output_tokens || usage.outputTokens);
      }
      return;
    }

    if (payload.type === 'message_stop' && payload.stop_reason) {
      stopReason = payload.stop_reason;
    }
  });

  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return { content, stopReason, usage, chunks };
}

async function requestWithRetry(url, init, timeoutMs, retries) {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || !shouldRetryStatus(response.status) || attempt >= retries) {
        return response;
      }

      const waitMs = resolveRetryDelay(attempt, response.headers.get('retry-after'));
      await sleep(waitMs);
      attempt += 1;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (attempt >= retries) {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        await sleep(resolveRetryDelay(attempt));
        attempt += 1;
        continue;
      }

      if (attempt >= retries) {
        throw error;
      }

      await sleep(resolveRetryDelay(attempt));
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function shouldRetryStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function resolveRetryDelay(attempt, retryAfterHeader) {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 10000);
  }
  return Math.min(500 * Math.pow(2, attempt), 5000);
}

async function parseSSE(response, onEvent) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Streaming response body is unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const event = parseSSEEvent(frame);
      if (!event) continue;
      onEvent(event);
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) {
    const event = parseSSEEvent(tail);
    if (event) onEvent(event);
  }
}

function parseSSEEvent(frame) {
  const lines = frame.split(/\r?\n/);
  let eventName = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || eventName;
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;
  const dataText = dataLines.join('\n').trim();
  if (!dataText || dataText === '[DONE]') return null;

  try {
    return { event: eventName, data: JSON.parse(dataText) };
  } catch {
    return { event: eventName, data: { raw: dataText } };
  }
}

async function buildApiError(code, fallbackMessage, response, cfg) {
  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    bodyText = '';
  }

  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  const message =
    parsed?.error?.message ||
    parsed?.message ||
    bodyText ||
    `${fallbackMessage} (${response.status})`;

  return {
    success: false,
    error: {
      message,
      code,
      type: 'ClaudeAPIError',
      status: response.status,
      retriable: shouldRetryStatus(response.status)
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'anthropic',
      model: cfg.model,
      timestamp: new Date().toISOString()
    }
  };
}

function buildSuccess(data, cfg) {
  return {
    success: true,
    data,
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'anthropic',
      model: cfg.model,
      timestamp: new Date().toISOString()
    }
  };
}

function buildError(code, error, meta = {}) {
  return {
    success: false,
    error: {
      message: error?.message || 'Unknown error',
      code,
      type: error?.name || 'Error'
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function readPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function readBoundedInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function asNonEmptyString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch API is unavailable. Node.js 18+ is required.');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
