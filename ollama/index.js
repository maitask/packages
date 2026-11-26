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
const PACKAGE_VERSION = '0.1.1';
const DEFAULT_BASE_URL = 'http://localhost:11434';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;

async function execute(input = {}, options = {}, context = {}) {
  const safeInput = isPlainObject(input) ? input : {};
  const safeOptions = isPlainObject(options) ? options : {};
  const safeContext = isPlainObject(context) ? context : {};
  let cfg = null;

  try {
    ensureFetch();

    cfg = buildConfig(safeInput, safeOptions, safeContext);
    const endpoint = cfg.openAICompat ? `${cfg.baseUrl}/v1/chat/completions` : `${cfg.baseUrl}/api/chat`;
    const requestBody = buildRequestBody(safeInput, cfg);

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

    const result = await readJsonResponse(response);
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

function buildConfig(input, options, context = {}) {
  const configuredBaseUrl =
    asNonEmptyString(options.baseUrl) ||
    asNonEmptyString(options.base_url) ||
    asNonEmptyString(context?.env?.OLLAMA_BASE_URL);
  const usingBuiltInLocalDefault = !configuredBaseUrl;
  const allowPrivateHosts = usingBuiltInLocalDefault
    ? options.allowPrivateHosts !== false
    : options.allowPrivateHosts === true;
  const allowInsecureHttp =
    options.allowInsecureHttp === true ||
    allowPrivateHosts ||
    usingBuiltInLocalDefault;

  const baseUrl = normalizeBaseUrl(
    configuredBaseUrl || DEFAULT_BASE_URL,
    allowPrivateHosts,
    allowInsecureHttp
  );

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
    const nativeOptions = Object.create(null);
    if (input.temperature !== undefined) nativeOptions.temperature = readNumber(input.temperature, undefined);
    if (input.top_p !== undefined) nativeOptions.top_p = readNumber(input.top_p, undefined);
    if (input.top_k !== undefined) nativeOptions.top_k = readPositiveInt(input.top_k, 40);
    if (input.max_tokens !== undefined || input.num_predict !== undefined) {
      nativeOptions.num_predict = readPositiveInt(input.max_tokens ?? input.num_predict, 512);
    }

    if (isPlainObject(input.options)) {
      for (const key of Object.keys(input.options)) {
        if (Object.hasOwn(input.options, key) && isSafeKey(key)) {
          nativeOptions[key] = input.options[key];
        }
      }
    }
    if (Object.keys(nativeOptions).length > 0) {
      body.options = nativeOptions;
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
    const rawText = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
    if (!rawText) return;
    for (const line of rawText.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      try {
        onItem(JSON.parse(text));
      } catch {
        // Ignore malformed line and continue
      }
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

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
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }

  buffer += decoder.decode();
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
    const rawText = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
    if (!rawText) return;
    for (const frame of rawText.split(/\r?\n\r?\n/)) {
      const event = parseSSEEvent(frame);
      if (event) onEvent(event);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const event = parseSSEEvent(frame);
        if (!event) continue;
        onEvent(event);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
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
  const runtimeFetch = usesMaitaskRuntimeFetch();
  while (true) {
    const controller = runtimeFetch ? null : new AbortController();
    const timeout = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchInit = {
        ...init,
        redirect: 'manual',
        timeoutMs
      };
      if (runtimeFetch) {
        fetchInit.maxResponseBytes = MAX_RESPONSE_BYTES;
      } else {
        fetchInit.signal = controller.signal;
      }
      const response = await fetch(url, fetchInit);
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        if (response?.body && typeof response.body.cancel === 'function') {
          try { await response.body.cancel(); } catch {}
        }
        const redirectErr = new Error('HTTP redirects are not allowed');
        redirectErr.nonRetryable = true;
        throw redirectErr;
      }
      if (response.ok || !shouldRetryStatus(response.status) || attempt >= retries) {
        return response;
      }

      const waitMs = resolveRetryDelay(attempt, response.headers?.get?.('retry-after'));
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      await sleep(waitMs);
      attempt += 1;
    } catch (error) {
      if (error?.nonRetryable) {
        throw error;
      }
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
      if (timeout !== null) {
        clearTimeout(timeout);
      }
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
    bodyText = await readBoundedText(response, MAX_ERROR_BYTES, false);
  } catch {
    bodyText = '';
  }

  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }

  const rawMessage =
    parsed?.error?.message ||
    (typeof parsed?.error === 'string' ? parsed.error : '') ||
    parsed?.message ||
    bodyText ||
    `${fallbackMessage} (${response.status})`;
  const message = redactSensitiveText(rawMessage);

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
  const usage = normalizeUsage(data?.usage);
  return {
    success: true,
    data,
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'ollama',
      model: cfg.model,
      endpoint: cfg.openAICompat ? 'openai-compat' : 'native',
      usage,
      timestamp: new Date().toISOString()
    }
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };
  }
  const promptTokens = Number(usage.promptTokens ?? usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completionTokens ?? usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? promptTokens + completionTokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function buildError(code, error, meta = {}) {
  return {
    success: false,
    error: {
      message: redactSensitiveText(error?.message || 'Unknown error'),
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

function normalizeBaseUrl(value, allowPrivateHosts, allowInsecureHttp) {
  let parsedBase;
  try {
    parsedBase = new URL(String(value));
  } catch {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }
  if (parsedBase.username || parsedBase.password) {
    throw new Error('baseUrl must not include embedded credentials');
  }
  if (parsedBase.protocol !== 'https:' && !(parsedBase.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error('baseUrl must use https unless allowInsecureHttp is enabled');
  }
  if (!allowPrivateHosts && isBlockedHost(parsedBase.hostname)) {
    throw new Error('baseUrl must not point to a private or internal host');
  }
  return parsedBase.toString().replace(/\/$/, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function usesMaitaskRuntimeFetch() {
  return Boolean(
    typeof Deno !== 'undefined' &&
      Deno &&
      Deno.core &&
      Deno.core.ops &&
      typeof Deno.core.ops.op_http_request === 'function'
  );
}

function redactSensitiveText(message) {
  return String(message || 'Unknown error')
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
}

async function readBoundedText(response, maxBytes, throwOnLimit) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    let out = '';
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (totalBytes + value.byteLength > maxBytes) {
          if (throwOnLimit) {
            throw new Error(`Ollama response exceeds ${maxBytes} byte limit`);
          }
          const remaining = maxBytes - totalBytes;
          if (remaining > 0) {
            const slice = value.subarray(0, remaining);
            out += decoder ? decoder.decode(slice, { stream: true }) : String.fromCharCode(...slice);
          }
          break;
        }
        out += decoder ? decoder.decode(value, { stream: true }) : String.fromCharCode(...value);
        totalBytes += value.byteLength;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
    if (decoder) out += decoder.decode();
    return out;
  }
  if (typeof response?.text === 'function') {
    const text = await response.text();
    if (typeof text === 'string' && text.length > maxBytes) {
      if (throwOnLimit) {
        throw new Error(`Ollama response exceeds ${maxBytes} byte limit`);
      }
      return text.slice(0, maxBytes);
    }
    return text || '';
  }
  return '';
}

async function readJsonResponse(response) {
  if (!response?.body?.getReader && typeof response?.text !== 'function' && typeof response?.json === 'function') {
    return await response.json();
  }
  const text = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Ollama API returned invalid JSON');
  }
}

function isBlockedHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized === 'local' ||
    normalized === 'internal' ||
    normalized === 'localdomain' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.localdomain')
  ) {
    return true;
  }
  if (normalized.includes(':')) {
    const clean = normalized.split('%')[0];
    const hextets = parseIpv6Hextets(clean);
    if (!hextets) return true;
    const allZero = hextets.every(part => part === 0);
    const isLoopback = hextets.slice(0, 7).every(part => part === 0) && hextets[7] === 1;
    if (allZero || isLoopback) return true;
    if ((hextets[0] & 0xffc0) === 0xfe80) return true;
    if ((hextets[0] & 0xfe00) === 0xfc00) return true;
    if (hextets.slice(0, 5).every(part => part === 0) && hextets[5] === 0xffff) return true;
    return false;
  }
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [, a, b, c, d] = ipv4.map(Number);
  if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return true;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseIpv6Hextets(address) {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parsePart = part => {
    if (!part) return [];
    const tokens = part.split(':');
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) return null;
      if (token.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const v4 = token.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (!v4) return null;
        const octets = v4.slice(1).map(Number);
        if (octets.some(o => o < 0 || o > 255)) return null;
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        out.push(parseInt(token, 16));
      }
    }
    return out;
  };
  const left = parsePart(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parsePart(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
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
