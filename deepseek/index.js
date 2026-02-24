/**
 * @maitask/deepseek
 * DeepSeek integration via OpenAI-compatible Chat Completions API.
 *
 * Production-focused behavior:
 * - Strict input normalization
 * - Timeout + retry with exponential backoff
 * - Streaming SSE aggregation
 * - Unified success/error envelope
 */

const PACKAGE_NAME = '@maitask/deepseek';
const PACKAGE_VERSION = '0.1.0';
const API_ENDPOINT = 'https://api.deepseek.com/chat/completions';

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
          Authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify(requestBody)
      },
      cfg.timeoutMs,
      cfg.retries
    );

    if (!response.ok) {
      return buildApiError('DEEPSEEK_API_ERROR', 'DeepSeek API request failed', response, cfg);
    }

    if (cfg.stream) {
      const streamResult = await parseDeepSeekStream(response);
      return buildSuccess(
        {
          content: streamResult.content,
          reasoningContent: streamResult.reasoningContent,
          finishReason: streamResult.finishReason,
          model: cfg.model,
          usage: streamResult.usage,
          chunks: streamResult.chunks
        },
        cfg
      );
    }

    const result = await response.json();
    const message = result.choices?.[0]?.message || {};

    return buildSuccess(
      {
        content: message.content || '',
        reasoningContent: message.reasoning_content || null,
        finishReason: result.choices?.[0]?.finish_reason || null,
        model: result.model || cfg.model,
        usage: {
          promptTokens: Number(result.usage?.prompt_tokens || 0),
          completionTokens: Number(result.usage?.completion_tokens || 0),
          totalTokens: Number(result.usage?.total_tokens || 0),
          promptCacheHitTokens: Number(result.usage?.prompt_cache_hit_tokens || 0),
          promptCacheMissTokens: Number(result.usage?.prompt_cache_miss_tokens || 0)
        },
        raw: result
      },
      cfg
    );
  } catch (error) {
    return buildError('DEEPSEEK_API_ERROR', error, {
      provider: 'deepseek'
    });
  }
}

function buildConfig(input, options, context) {
  const apiKey =
    options.apiKey || options.api_key || input.apiKey || input.api_key || context?.secrets?.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DeepSeek API key is required. Provide via options.apiKey or context.secrets.DEEPSEEK_API_KEY');
  }

  const model = String(input.model || options.model || 'deepseek-chat').trim();

  return {
    apiKey,
    model,
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

  const isReasoningModel = cfg.model.includes('reasoner');
  const body = {
    model: cfg.model,
    messages,
    stream: cfg.stream
  };

  if (!isReasoningModel) {
    if (input.temperature !== undefined) body.temperature = readNumber(input.temperature, undefined);
    if (input.top_p !== undefined) body.top_p = readNumber(input.top_p, undefined);
    if (input.frequency_penalty !== undefined) body.frequency_penalty = readNumber(input.frequency_penalty, undefined);
    if (input.presence_penalty !== undefined) body.presence_penalty = readNumber(input.presence_penalty, undefined);
  }

  if (input.max_tokens !== undefined || input.maxTokens !== undefined) {
    body.max_tokens = readPositiveInt(input.max_tokens ?? input.maxTokens, 1024);
  }

  if (Array.isArray(input.stop)) body.stop = input.stop;
  if (input.jsonMode || input.json_mode || input.response_format?.type === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  if (Array.isArray(input.tools)) body.tools = input.tools;
  if (input.tool_choice !== undefined) body.tool_choice = input.tool_choice;
  if (Array.isArray(input.functions)) body.functions = input.functions;
  if (input.function_call !== undefined) body.function_call = input.function_call;

  return body;
}

function normalizeMessages(input) {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages
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

async function parseDeepSeekStream(response) {
  const chunks = [];
  let content = '';
  let reasoningContent = '';
  let finishReason = null;
  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 0
  };

  await parseSSE(response, (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    if (payload.usage) {
      usage.promptTokens = Number(payload.usage.prompt_tokens || usage.promptTokens);
      usage.completionTokens = Number(payload.usage.completion_tokens || usage.completionTokens);
      usage.totalTokens = Number(payload.usage.total_tokens || usage.totalTokens);
      usage.promptCacheHitTokens = Number(payload.usage.prompt_cache_hit_tokens || usage.promptCacheHitTokens);
      usage.promptCacheMissTokens = Number(payload.usage.prompt_cache_miss_tokens || usage.promptCacheMissTokens);
    }

    const choice = payload.choices?.[0];
    if (!choice) return;

    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      content += delta.content;
      chunks.push(delta.content);
    }

    if (typeof delta.reasoning_content === 'string') {
      reasoningContent += delta.reasoning_content;
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  });

  return {
    content,
    reasoningContent: reasoningContent || null,
    finishReason,
    usage,
    chunks
  };
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
      type: 'DeepSeekAPIError',
      status: response.status,
      retriable: shouldRetryStatus(response.status)
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'deepseek',
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
      provider: 'deepseek',
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

execute;
