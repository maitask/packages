/**
 * @maitask/ollama
 * Ollama local model integration.
 *
 * Production-focused behavior:
 * - Native and OpenAI-compatible endpoints
 * - Timeout + retry with exponential backoff
 * - Native NDJSON stream parsing and OpenAI-style SSE parsing
 * - Unified success/error envelope
 */

const PACKAGE_NAME = '@maitask/ollama';
const PACKAGE_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'http://localhost:11434';

async function execute(input = {}, options = {}, context = {}) {
  try {
    ensureFetch();

    const cfg = buildConfig(input, options);
    const endpoint = cfg.openAICompat ? `${cfg.baseUrl}/v1/chat/completions` : `${cfg.baseUrl}/api/chat`;
    const requestBody = buildRequestBody(input, cfg);

    const response = await requestWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      },
      cfg.timeoutMs,
      cfg.retries
    );

    if (!response.ok) {
      return buildApiError('OLLAMA_API_ERROR', 'Ollama API request failed', response, cfg);
    }

    if (cfg.stream) {
      const streamResult = cfg.openAICompat
        ? await parseOpenAICompatStream(response)
        : await parseNativeStream(response);

      return buildSuccess(
        {
          content: streamResult.content,
          finishReason: streamResult.finishReason,
          model: streamResult.model || cfg.model,
          usage: streamResult.usage,
          chunks: streamResult.chunks
        },
        cfg
      );
    }

    const result = await response.json();
    if (cfg.openAICompat) {
      return buildSuccess(
        {
          content: result.choices?.[0]?.message?.content || '',
          finishReason: result.choices?.[0]?.finish_reason || null,
          model: result.model || cfg.model,
          usage: {
            promptTokens: Number(result.usage?.prompt_tokens || 0),
            completionTokens: Number(result.usage?.completion_tokens || 0),
            totalTokens: Number(result.usage?.total_tokens || 0)
          },
          raw: result
        },
        cfg
      );
    }

    return buildSuccess(
      {
        content: result.message?.content || '',
        finishReason: result.done ? 'stop' : null,
        model: result.model || cfg.model,
        usage: {
          promptTokens: Number(result.prompt_eval_count || 0),
          completionTokens: Number(result.eval_count || 0),
          totalTokens: Number(result.prompt_eval_count || 0) + Number(result.eval_count || 0)
        },
        raw: result
      },
      cfg
    );
  } catch (error) {
    return buildError('OLLAMA_API_ERROR', error, {
      provider: 'ollama'
    });
  }
}

function buildConfig(input, options) {
  const baseUrl = String(options.baseUrl || options.base_url || input.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');

  return {
    baseUrl,
    openAICompat: Boolean(options.openaiCompat ?? options.openai_compat ?? input.openaiCompat ?? false),
    model: String(input.model || options.model || 'llama3.2').trim(),
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
    messages,
    stream: cfg.stream
  };

  if (cfg.openAICompat) {
    if (input.temperature !== undefined) body.temperature = readNumber(input.temperature, undefined);
    if (input.top_p !== undefined) body.top_p = readNumber(input.top_p, undefined);
    if (input.max_tokens !== undefined || input.maxTokens !== undefined) {
      body.max_tokens = readPositiveInt(input.max_tokens ?? input.maxTokens, 512);
    }
  } else {
    const nativeOptions = {};
    if (input.temperature !== undefined) nativeOptions.temperature = readNumber(input.temperature, undefined);
    if (input.top_p !== undefined) nativeOptions.top_p = readNumber(input.top_p, undefined);
    if (input.top_k !== undefined) nativeOptions.top_k = readPositiveInt(input.top_k, 40);
    if (input.max_tokens !== undefined || input.num_predict !== undefined) {
      nativeOptions.num_predict = readPositiveInt(input.max_tokens ?? input.num_predict, 512);
    }

    const extraOptions = input.options && typeof input.options === 'object' ? input.options : {};
    const mergedOptions = { ...nativeOptions, ...extraOptions };
    if (Object.keys(mergedOptions).length > 0) {
      body.options = mergedOptions;
    }

    if (input.jsonMode || input.json_mode) {
      body.format = 'json';
    }
  }

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
        return null;
      })
      .filter(Boolean);
  }

  const text = asNonEmptyString(input.text || input.prompt);
  if (!text) return [];
  return [{ role: 'user', content: text }];
}

async function parseNativeStream(response) {
  const chunks = [];
  let content = '';
  let model = null;
  let finishReason = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  await parseNDJSON(response, (payload) => {
    if (!payload || typeof payload !== 'object') return;

    if (!model && payload.model) model = payload.model;

    const chunk = payload.message?.content;
    if (typeof chunk === 'string' && chunk.length > 0) {
      content += chunk;
      chunks.push(chunk);
    }

    if (payload.done === true) {
      finishReason = payload.done_reason || 'stop';
      usage.promptTokens = Number(payload.prompt_eval_count || usage.promptTokens);
      usage.completionTokens = Number(payload.eval_count || usage.completionTokens);
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
    }
  });

  return { content, finishReason, model, usage, chunks };
}

async function parseOpenAICompatStream(response) {
  const chunks = [];
  let content = '';
  let model = null;
  let finishReason = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  await parseSSE(response, (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    if (!model && payload.model) model = payload.model;

    if (payload.usage) {
      usage.promptTokens = Number(payload.usage.prompt_tokens || usage.promptTokens);
      usage.completionTokens = Number(payload.usage.completion_tokens || usage.completionTokens);
      usage.totalTokens = Number(payload.usage.total_tokens || usage.totalTokens);
    }

    const choice = payload.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === 'string') {
      content += delta.content;
      chunks.push(delta.content);
    }

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
  });

  return { content, finishReason, model, usage, chunks };
}

async function parseNDJSON(response, onItem) {
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
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      try {
        onItem(JSON.parse(text));
      } catch {
        // Ignore malformed line and continue
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      onItem(JSON.parse(tail));
    } catch {
      // Ignore malformed trailing line
    }
  }
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
    parsed?.error ||
    parsed?.message ||
    bodyText ||
    `${fallbackMessage} (${response.status})`;

  return {
    success: false,
    error: {
      message,
      code,
      type: 'OllamaAPIError',
      status: response.status,
      retriable: shouldRetryStatus(response.status)
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'ollama',
      model: cfg.model,
      endpoint: cfg.openAICompat ? 'openai-compat' : 'native',
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
      provider: 'ollama',
      model: cfg.model,
      endpoint: cfg.openAICompat ? 'openai-compat' : 'native',
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
