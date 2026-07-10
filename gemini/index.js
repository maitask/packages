/**
 * @maitask/gemini
 * Google Gemini integration using Generative Language API.
 *
 * Production-focused behavior:
 * - Strict input normalization
 * - Timeout + retry with exponential backoff
 * - Streaming SSE aggregation via streamGenerateContent
 * - Unified success/error envelope
 */

const PACKAGE_NAME = '@maitask/gemini';
const PACKAGE_VERSION = '0.1.0';
const DEFAULT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

async function execute(input = {}, options = {}, context = {}) {
  try {
    ensureFetch();

    const cfg = buildConfig(input, options, context);
    const requestBody = buildRequestBody(input, cfg);
    const endpoint = cfg.stream
      ? `${cfg.baseUrl}/${cfg.model}:streamGenerateContent?alt=sse`
      : `${cfg.baseUrl}/${cfg.model}:generateContent`;

    const response = await requestWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cfg.apiKey
        },
        body: JSON.stringify(requestBody)
      },
      cfg.timeoutMs,
      cfg.retries
    );

    if (!response.ok) {
      return buildApiError('GEMINI_API_ERROR', 'Gemini API request failed', response, cfg);
    }

    if (cfg.stream) {
      const streamResult = await parseGeminiStream(response);
      return buildSuccess(
        {
          content: streamResult.content,
          finishReason: streamResult.finishReason,
          model: cfg.model,
          usage: streamResult.usage,
          safetyRatings: streamResult.safetyRatings,
          chunks: streamResult.chunks
        },
        cfg
      );
    }

    const result = await response.json();
    const candidate = result.candidates?.[0] || {};

    return buildSuccess(
      {
        content: extractGeminiText(candidate.content),
        finishReason: candidate.finishReason || null,
        model: cfg.model,
        usage: {
          promptTokens: Number(result.usageMetadata?.promptTokenCount || 0),
          completionTokens: Number(result.usageMetadata?.candidatesTokenCount || 0),
          totalTokens: Number(result.usageMetadata?.totalTokenCount || 0)
        },
        safetyRatings: candidate.safetyRatings || [],
        raw: result
      },
      cfg
    );
  } catch (error) {
    return buildError('GEMINI_API_ERROR', error, {
      provider: 'google'
    });
  }
}

function buildConfig(input, options, context) {
  const apiKey =
    options.apiKey || options.api_key || input.apiKey || input.api_key || context?.secrets?.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Google API key is required. Provide via options.apiKey or context.secrets.GOOGLE_API_KEY');
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      options.baseUrl || context?.env?.GEMINI_API_BASE_URL,
      DEFAULT_API_BASE_URL
    ),
    model: String(input.model || options.model || 'gemini-2.5-pro').trim(),
    stream: Boolean(input.stream ?? options.stream ?? false),
    timeoutMs: readBoundedInt(input.timeoutMs ?? options.timeoutMs, 1000, 300000, 60000),
    retries: readBoundedInt(input.retries ?? options.retries, 0, 5, 2)
  };
}

function buildRequestBody(input, cfg) {
  const contents = normalizeContents(input);
  if (!contents.length) {
    throw new Error('contents or text/prompt/messages is required');
  }

  const body = { contents };

  const generationConfig = {};
  if (input.temperature !== undefined) generationConfig.temperature = readNumber(input.temperature, undefined);
  if (input.maxOutputTokens !== undefined || input.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = readPositiveInt(input.maxOutputTokens ?? input.max_tokens, 1024);
  }
  if (input.topP !== undefined || input.top_p !== undefined) generationConfig.topP = readNumber(input.topP ?? input.top_p, undefined);
  if (input.topK !== undefined || input.top_k !== undefined) generationConfig.topK = readPositiveInt(input.topK ?? input.top_k, 40);
  if (Array.isArray(input.stopSequences)) generationConfig.stopSequences = input.stopSequences;
  if (input.responseMimeType) generationConfig.responseMimeType = String(input.responseMimeType);

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  if (Array.isArray(input.safetySettings)) {
    body.safetySettings = input.safetySettings;
  }

  if (input.systemInstruction) {
    body.systemInstruction = normalizeSystemInstruction(input.systemInstruction);
  }

  return body;
}

function normalizeContents(input) {
  if (Array.isArray(input.contents) && input.contents.length > 0) {
    return input.contents;
  }

  const text = asNonEmptyString(input.text || input.prompt);
  if (text) {
    return [{ role: 'user', parts: [{ text }] }];
  }

  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages
      .map((message) => {
        if (!message || typeof message !== 'object') return null;
        const role = String(message.role || 'user').toLowerCase() === 'assistant' ? 'model' : 'user';
        const parts = normalizeParts(message.content);
        if (!parts.length) return null;
        return { role, parts };
      })
      .filter(Boolean);
  }

  return [];
}

function normalizeSystemInstruction(value) {
  if (typeof value === 'string') {
    return { parts: [{ text: value }] };
  }
  if (value && typeof value === 'object') {
    return value;
  }
  return undefined;
}

function normalizeParts(content) {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [{ text }] : [];
  }

  if (Array.isArray(content)) {
    return content.filter((part) => part && typeof part === 'object');
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return [{ text: content.text }];
    if (content.inlineData || content.fileData) return [content];
  }

  return [];
}

function extractGeminiText(content) {
  const parts = content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

async function parseGeminiStream(response) {
  const chunks = [];
  let content = '';
  let finishReason = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let safetyRatings = [];

  await parseSSE(response, (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    const candidate = payload.candidates?.[0] || {};
    const text = extractGeminiText(candidate.content);
    if (text) {
      content += text;
      chunks.push(text);
    }

    if (candidate.finishReason) {
      finishReason = candidate.finishReason;
    }

    if (Array.isArray(candidate.safetyRatings) && candidate.safetyRatings.length) {
      safetyRatings = candidate.safetyRatings;
    }

    if (payload.usageMetadata) {
      usage.promptTokens = Number(payload.usageMetadata.promptTokenCount || usage.promptTokens);
      usage.completionTokens = Number(payload.usageMetadata.candidatesTokenCount || usage.completionTokens);
      usage.totalTokens = Number(payload.usageMetadata.totalTokenCount || usage.totalTokens);
    }
  });

  return { content, finishReason, usage, safetyRatings, chunks };
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
      type: 'GeminiAPIError',
      status: response.status,
      retriable: shouldRetryStatus(response.status)
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'google',
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
      provider: 'google',
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

function normalizeBaseUrl(value, fallback) {
  const candidate = asNonEmptyString(value) || fallback;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }

  return parsed.toString().replace(/\/$/, '');
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
