/**
 * @maitask/image-generator
 * Image generation via OpenAI or Stability AI APIs
 *
 * @version 0.1.1
 * @license MIT
 */

const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const STABILITY_URL = 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image';

const MAX_IMAGE_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_ERROR_BYTES = 16 * 1024;

async function execute(input, options = {}, context = {}) {
  let activeApiKey = '';
  try {
    const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const safeContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const payload = asObject(input);
    const prompt = readRequiredString(payload.prompt, 'prompt');
    const provider = normalizeProvider(payload.provider || safeOptions.provider || 'openai');
    const secrets = safeContext.secrets && typeof safeContext.secrets === 'object' ? safeContext.secrets : {};
    const contextKey = provider === 'stability' ? secrets.STABILITY_API_KEY : secrets.OPENAI_API_KEY;
    const apiKey = readRequiredString(safeOptions.apiKey || contextKey, 'apiKey');
    activeApiKey = apiKey;
    const timeoutMs = readTimeout(payload.timeoutMs ?? safeOptions.timeoutMs);

    const generated =
      provider === 'stability'
        ? await generateWithStability({ prompt, apiKey, payload, timeoutMs })
        : await generateWithOpenAI({ prompt, apiKey, payload, timeoutMs });

    return {
      success: true,
      data: {
        provider,
        prompt,
        ...generated
      },
      metadata: {
        package: '@maitask/image-generator',
        timestamp: new Date().toISOString(),
        version: '0.1.1'
      }
    };
  } catch (error) {
    return buildError(error, 'IMAGE_GENERATOR_ERROR', 'ImageGeneratorError', activeApiKey);
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

async function generateWithOpenAI({ prompt, apiKey, payload, timeoutMs }) {
  const model = readOptionalString(payload.model, 'dall-e-3');
  const size = readOptionalString(payload.size, '1024x1024');
  const nInput = toPositiveInteger(payload.n, 1);
  const n = model === 'dall-e-3' ? 1 : Math.min(nInput, 10);

  const body = { model, prompt, n, size };

  const data = await fetchJson(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body,
    timeoutMs
  });

  return {
    model,
    size,
    count: Array.isArray(data.data) ? data.data.length : 0,
    images: (data.data || []).map(item => ({
      url: item.url || null,
      b64: item.b64_json || null,
      revisedPrompt: item.revised_prompt || null
    }))
  };
}

async function generateWithStability({ prompt, apiKey, payload, timeoutMs }) {
  const width = toPositiveInteger(payload.width, 1024);
  const height = toPositiveInteger(payload.height, 1024);
  const samples = Math.min(toPositiveInteger(payload.n, 1), 4);

  const body = {
    text_prompts: [{ text: prompt }],
    width,
    height,
    samples
  };

  const data = await fetchJson(STABILITY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body,
    timeoutMs
  });

  return {
    width,
    height,
    count: Array.isArray(data.artifacts) ? data.artifacts.length : 0,
    images: (data.artifacts || []).map(item => ({
      b64: item.base64 || null,
      finishReason: item.finishReason || null,
      seed: item.seed || null
    }))
  };
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'stability') {
    return provider;
  }
  throw new Error(`Unsupported provider '${value}'. Use 'openai' or 'stability'.`);
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

async function readBoundedText(response, maxBytes, throwOnLimit) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    let out = '';
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (total + value.byteLength > maxBytes) {
          if (throwOnLimit) {
            throw new Error(`Image generation response exceeds ${maxBytes} byte limit`);
          }
          const remaining = maxBytes - total;
          if (remaining > 0) {
            const slice = value.subarray(0, remaining);
            out += decoder ? decoder.decode(slice, { stream: true }) : String.fromCharCode(...slice);
          }
          break;
        }
        out += decoder ? decoder.decode(value, { stream: true }) : String.fromCharCode(...value);
        total += value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    if (decoder) out += decoder.decode();
    return out;
  }
  const text = await response.text();
  if (typeof text === 'string' && text.length > maxBytes) {
    if (throwOnLimit) {
      throw new Error(`Image generation response exceeds ${maxBytes} byte limit`);
    }
    return text.slice(0, maxBytes);
  }
  return text || '';
}

async function fetchJson(url, { method, headers, body, timeoutMs }) {
  const runtimeFetch = usesMaitaskRuntimeFetch();
  const controller = runtimeFetch ? null : new AbortController();
  const timer = runtimeFetch ? null : setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchInit = {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: 'manual',
      timeoutMs
    };
    if (runtimeFetch) {
      fetchInit.maxResponseBytes = MAX_IMAGE_RESPONSE_BYTES;
    } else {
      fetchInit.signal = controller.signal;
    }
    const response = await fetch(url, fetchInit);
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      throw new Error('Image generation endpoint must not redirect');
    }

    if (!response.ok) {
      const errText = await readBoundedText(response, MAX_IMAGE_ERROR_BYTES, false);
      const errData = tryParseJson(errText);
      throw new Error(errData?.error?.message || errData?.message || errText || `Upstream request failed with status ${response.status}`);
    }

    const text = await readBoundedText(response, MAX_IMAGE_RESPONSE_BYTES, true);
    const data = tryParseJson(text);

    if (data == null) {
      throw new Error('Upstream response is not valid JSON');
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function toPositiveInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
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
  const text = readOptionalString(value);
  if (!text) throw new Error(`${key} is required`);
  return text;
}

function readOptionalString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) return 30000;
  return Math.min(timeout, 120000);
}

function buildError(error, code, type, secret = '') {
  const rawMessage = error?.message || 'Unknown error';
  const redactedSecret = secret ? String(rawMessage).split(secret).join('[redacted]') : String(rawMessage);
  const safeMessage = redactedSecret.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  return {
    success: false,
    error: {
      message: safeMessage,
      code,
      type
    },
    metadata: {
      package: '@maitask/image-generator',
      timestamp: new Date().toISOString(),
      version: '0.1.1'
    }
  };
}
