/**
 * @maitask/image-generator
 * Image generation via OpenAI or Stability AI APIs
 *
 * @version 0.1.0
 * @license MIT
 */

const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const STABILITY_URL = 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image';

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const prompt = readRequiredString(payload.prompt, 'prompt');
    const provider = normalizeProvider(payload.provider || options.provider || 'openai');
    const apiKey = readRequiredString(payload.apiKey || options.apiKey, 'apiKey');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

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
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'IMAGE_GENERATOR_ERROR', 'ImageGeneratorError');
  }
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
      throw new Error(data?.error?.message || data?.message || text || `Upstream request failed with status ${response.status}`);
    }

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
    clearTimeout(timer);
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
