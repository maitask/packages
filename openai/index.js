/**
 * @maitask/openai
 * OpenAI chat integration using Chat Completions API.
 *
 * Production-focused behavior:
 * - Strict input normalization
 * - Timeout + retry with exponential backoff
 * - Streaming SSE aggregation
 * - Unified success/error envelope
 */

const PACKAGE_NAME = '@maitask/openai';
const PACKAGE_VERSION = '0.1.1';
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
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
    const requestBody = buildRequestBody(safeInput, cfg);

    const response = await requestWithRetry(
      `${cfg.baseUrl}/chat/completions`,
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
      return buildApiError('OPENAI_API_ERROR', 'OpenAI API request failed', response, cfg, safeContext);
    }

    if (cfg.stream) {
      const streamResult = await parseOpenAIStream(response);
      return buildSuccess(
        {
          content: streamResult.content,
          finishReason: streamResult.finishReason,
          model: requestBody.model,
          usage: streamResult.usage,
          chunks: streamResult.chunks
        },
        cfg
      );
    }

    const result = await readJsonResponse(response);
    return buildSuccess(
      {
        content: result.choices?.[0]?.message?.content || '',
        finishReason: result.choices?.[0]?.finish_reason || null,
        model: result.model || requestBody.model,
        usage: {
          promptTokens: Number(result.usage?.prompt_tokens || 0),
          completionTokens: Number(result.usage?.completion_tokens || 0),
          totalTokens: Number(result.usage?.total_tokens || 0)
        },
        raw: result
      },
      cfg
    );
  } catch (error) {
    return buildError(
      'OPENAI_API_ERROR',
      error,
      {
        provider: 'openai'
      },
      cfg,
      safeOptions,
      safeContext
    );
  }
}

function buildConfig(input, options, context) {
  const apiKey = asNonEmptyString(options.apiKey) || asNonEmptyString(context?.secrets?.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('OpenAI API key is required. Provide via options.apiKey or context.secrets.OPENAI_API_KEY');
  }

  const allowPrivateHosts = options.allowPrivateHosts === true;
  const allowInsecureHttp = options.allowInsecureHttp === true || allowPrivateHosts;

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      options.baseUrl || context?.env?.OPENAI_API_BASE_URL,
      DEFAULT_API_BASE_URL,
      allowPrivateHosts,
      allowInsecureHttp
    ),
    model: String(input.model || options.model || 'gpt-5').trim(),
    temperature: readNumber(input.temperature ?? options.temperature, 0.7),
    maxTokens: readPositiveInt(input.maxTokens ?? input.max_tokens ?? options.maxTokens ?? options.max_tokens, 1000),
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
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: cfg.stream
  };

  if (input.top_p !== undefined) body.top_p = readNumber(input.top_p, undefined);
  if (input.frequency_penalty !== undefined) body.frequency_penalty = readNumber(input.frequency_penalty, undefined);
  if (input.presence_penalty !== undefined) body.presence_penalty = readNumber(input.presence_penalty, undefined);

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
      .map(normalizeMessage)
      .filter(Boolean);
  }

  const text = asNonEmptyString(input.text || input.prompt);
  if (!text) return [];
  return [{ role: 'user', content: text }];
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = asNonEmptyString(message.role) || 'user';
  const content = message.content;
  if (typeof content === 'string') {
    const text = content.trim();
    if (!text) return null;
    return { role, content: text };
  }

  if (Array.isArray(content)) {
    return { role, content };
  }

  return null;
}

async function parseOpenAIStream(response) {
  const chunks = [];
  let content = '';
  let finishReason = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  await parseSSE(response, (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    if (payload.usage) {
      usage.promptTokens = Number(payload.usage.prompt_tokens || usage.promptTokens);
      usage.completionTokens = Number(payload.usage.completion_tokens || usage.completionTokens);
      usage.totalTokens = Number(payload.usage.total_tokens || usage.totalTokens);
    }

    const choice = payload.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (typeof delta?.content === 'string') {
      content += delta.content;
      chunks.push(delta.content);
    } else if (Array.isArray(delta?.content)) {
      for (const part of delta.content) {
        const text = typeof part?.text === 'string' ? part.text : '';
        if (!text) continue;
        content += text;
        chunks.push(text);
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  });

  return { content, finishReason, usage, chunks };
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

async function buildApiError(code, fallbackMessage, response, cfg, context) {
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
    parsed?.message ||
    bodyText ||
    `${fallbackMessage} (${response.status})`;
  const message = redactSensitiveText(rawMessage, cfg, null, context);

  return {
    success: false,
    error: {
      message,
      code,
      type: 'OpenAIAPIError',
      status: response.status,
      retriable: shouldRetryStatus(response.status)
    },
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'openai',
      model: cfg.model,
      timestamp: new Date().toISOString()
    }
  };
}

function buildSuccess(data, cfg) {
  const usage = normalizeUsage(data?.usage);
  if (data && typeof data === 'object' && data.usage == null && usage) {
    data.usage = usage;
  }
  return {
    success: true,
    data,
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'openai',
      model: cfg.model,
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
  const promptTokens = Number(usage.prompt_tokens || usage.promptTokens || 0);
  const completionTokens = Number(usage.completion_tokens || usage.completionTokens || 0);
  const totalTokens = Number(usage.total_tokens || usage.totalTokens || promptTokens + completionTokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function buildError(code, error, meta = {}, cfg = null, options = null, context = null) {
  return {
    success: false,
    error: {
      message: redactSensitiveText(error?.message || 'Unknown error', cfg, options, context),
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
  const text = String(value).trim();
  return text;
}

function normalizeBaseUrl(value, fallback, allowPrivateHosts, allowInsecureHttp) {
  const candidate = asNonEmptyString(value) || fallback;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('baseUrl must not include embedded credentials');
  }

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error('baseUrl must use https unless allowInsecureHttp is enabled');
  }

  if (!allowPrivateHosts && isBlockedHost(parsed.hostname)) {
    throw new Error('baseUrl must not point to a private or internal host');
  }

  return parsed.toString().replace(/\/$/, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function redactSensitiveText(message, cfg, options, context) {
  let safe = String(message || 'Unknown error');
  const candidates = [
    cfg?.apiKey,
    options?.apiKey,
    context?.secrets?.OPENAI_API_KEY
  ];
  for (const secret of candidates) {
    if (typeof secret === 'string' && secret.length > 0) {
      safe = safe.split(secret).join('[redacted]');
    }
  }
  return safe.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
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
            throw new Error(`OpenAI response exceeds ${maxBytes} byte limit`);
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
        throw new Error(`OpenAI response exceeds ${maxBytes} byte limit`);
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
    throw new Error('OpenAI API returned invalid JSON');
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
