/**
 * @maitask/data-analyst
 * AI-powered data analysis and insight generation
 *
 * @version 0.1.0
 * @license MIT
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

async function execute(input, options = {}, context = {}) {
  try {
    const payload = asObject(input);
    const dataInput = payload.data;
    if (dataInput == null) {
      throw new Error('data is required');
    }

    const task = normalizeTask(payload.task || 'analyze');
    const provider = normalizeProvider(payload.provider || options.provider || 'openai');
    const apiKey = readRequiredString(payload.apiKey || options.apiKey, 'apiKey');
    const model = readOptionalString(payload.model || options.model, '');
    const timeoutMs = readTimeout(payload.timeoutMs ?? options.timeoutMs);

    const prompt = buildPrompt(dataInput, task);
    const analysis = await requestAnalysis({ provider, apiKey, model, prompt, timeoutMs });

    return {
      success: true,
      data: {
        task,
        provider,
        analysis
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }
    };
  } catch (error) {
    return buildError(error, 'DATA_ANALYST_ERROR', 'DataAnalystError');
  }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

function buildPrompt(dataInput, task) {
  const dataString = typeof dataInput === 'string' ? dataInput : JSON.stringify(dataInput, null, 2);

  const intent =
    task === 'summarize'
      ? 'a concise summary with key numbers'
      : task === 'trends'
        ? 'trend analysis with notable changes and anomalies'
        : 'key insights, descriptive statistics, and risks';

  return `Analyze the following dataset and provide ${intent}.\n\nDataset:\n${dataString}`;
}

async function requestAnalysis({ provider, apiKey, model, prompt, timeoutMs }) {
  if (provider === 'claude') {
    const body = {
      model: model || 'claude-3-5-haiku-20241022',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    };

    const result = await fetchJson(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body,
      timeoutMs
    });

    return result.content?.[0]?.text || '';
  }

  const body = {
    model: model || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }]
  };

  const result = await fetchJson(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body,
    timeoutMs
  });

  return result.choices?.[0]?.message?.content || '';
}

function normalizeTask(value) {
  const task = String(value || '').trim().toLowerCase();
  if (task === 'analyze' || task === 'summarize' || task === 'trends') {
    return task;
  }
  throw new Error(`Unsupported task '${value}'. Use 'analyze', 'summarize', or 'trends'.`);
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'claude') {
    return provider;
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
