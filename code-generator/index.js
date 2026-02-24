/**
 * @maitask/code-generator
 * AI-powered code generation using OpenAI or Claude
 *
 * @version 0.1.0
 * @license MIT
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const prompt = readRequiredString(payload.prompt, 'prompt');
    const language = readOptionalString(payload.language, 'javascript');
    const provider = normalizeProvider(payload.provider || options.provider || 'openai');
    const apiKey = readRequiredString(payload.apiKey || options.apiKey, 'apiKey');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const response = await callProvider({
      provider,
      apiKey,
      prompt,
      language,
      model: payload.model || options.model,
      timeoutMs
    });

    return {
      success: true,
      data: response,
      metadata: {
        provider,
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'CODE_GENERATOR_ERROR', 'CodeGeneratorError');
  }
}

execute;

async function callProvider({ provider, apiKey, prompt, language, model, timeoutMs }) {
  const systemPrompt = `You are an expert ${language} developer. Generate clean, production-ready code. Return code only.`;

  if (provider === 'claude') {
    const body = {
      model: model || 'claude-3-5-haiku-20241022',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    };

    const data = await fetchJson(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body,
      timeoutMs
    });

    return {
      code: data.content?.[0]?.text || '',
      language,
      model: body.model
    };
  }

  const body = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  };

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
    code: data.choices?.[0]?.message?.content || '',
    language,
    model: body.model
  };
}

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'claude') {
    return normalized;
  }
  throw new Error(`Unsupported provider '${value}'. Use 'openai' or 'claude'.`);
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
      const message = extractRemoteError(data, text, response.status);
      throw new Error(message);
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

function extractRemoteError(data, text, status) {
  return (
    data?.error?.message ||
    data?.message ||
    text ||
    `Upstream request failed with status ${status}`
  );
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
  if (!text) {
    throw new Error(`${key} is required`);
  }
  return text;
}

function readOptionalString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function readTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return 30000;
  }
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
