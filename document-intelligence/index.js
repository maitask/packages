/**
 * @maitask/document-intelligence
 * Fail-closed document summarization, classification, and extraction.
 */

const PACKAGE_NAME = '@maitask/document-intelligence';
const PACKAGE_VERSION = '1.0.0';
const CONTRACT_VERSION = '2026-06-27';
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const MAX_SOURCE_TEXT_CHARS = 24_000;
const MAX_DOCUMENTS = 20;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();
  let config = null;

  try {
    ensureFetch();
    const safeInput = isPlainObject(input) ? input : {};
    const safeOptions = isPlainObject(options) ? options : {};
    const safeContext = isPlainObject(context) ? context : {};
    config = buildConfig(safeInput, safeOptions, safeContext);
    const documents = collectDocuments(safeInput, config);
    if (!documents.length) {
      return buildFailure(
        new Error('Provide text, documents, or upstream items with readable content'),
        startedAt,
        safeContext,
        'DOCUMENT_INPUT_REQUIRED',
        null,
        config
      );
    }

    const result = await requestModel(documents, config);
    const deliverable = normalizeDeliverable(result.content, documents, config);
    if (!deliverable.body) {
      return buildFailure(
        new Error('The model did not return a publishable document result'),
        startedAt,
        safeContext,
        'DOCUMENT_OUTPUT_INVALID',
        result.usage,
        config
      );
    }

    const message = formatPublishedMessage(deliverable, config);
    const citations = config.includeSources
      ? deliverable.sources.map((source, index) => ({
          id: `S${index + 1}`,
          title: source.title,
          url: source.url || null
        }))
      : [];

    return {
      success: true,
      data: {
        items: [
          {
            index: 0,
            id: 'document-intelligence',
            data: {
              task: config.task,
              title: deliverable.title,
              body: deliverable.body,
              labels: deliverable.labels,
              fields: deliverable.fields,
              message
            },
            metadata: {
              language: config.language,
              model: config.model
            },
            citation_ids: citations.map(item => item.id)
          }
        ],
        summary: {
          total: 1,
          success_count: 1,
          failure_count: 0,
          metrics: {
            task: config.task,
            documents: documents.length,
            sources: citations.length
          }
        },
        deliverable,
        message,
        usage: result.usage
      },
      error: null,
      metadata: {
        contract_version: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        execution_id: safeContext?.execution_id || null,
        task: config.task,
        language: config.language,
        model: config.model,
        channel_message: message,
        usage: result.usage,
        execution_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      },
      citations
    };
  } catch (error) {
    return buildFailure(error, startedAt, context, undefined, null, config);
  }
}

function buildConfig(input, options, context) {
  const ai = isPlainObject(options.ai) ? options.ai : {};
  const output = isPlainObject(options.output) ? options.output : {};
  const apiKey = firstString(
    ai.apiKey,
    options.apiKey,
    context?.secrets?.OPENAI_API_KEY,
    context?.secrets?.DOCUMENT_INTELLIGENCE_API_KEY
  );
  if (!apiKey) {
    throw Object.assign(new Error('AI API key is required'), {
      code: 'DOCUMENT_AI_KEY_REQUIRED'
    });
  }

  const task = String(options.task || input.task || 'summarize')
    .trim()
    .toLowerCase();
  if (!['summarize', 'classify', 'extract'].includes(task)) {
    throw Object.assign(new Error('Task must be summarize, classify, or extract'), {
      code: 'DOCUMENT_TASK_INVALID'
    });
  }

  const language = String(options.language || input.language || 'zh-CN').trim();
  if (language !== 'zh-CN' && language !== 'en') {
    throw Object.assign(new Error('Language must be zh-CN or en'), {
      code: 'DOCUMENT_LANGUAGE_INVALID'
    });
  }

  const allowPrivateHosts = options.allowPrivateHosts === true || ai.allowPrivateHosts === true;
  const allowInsecureHttp = options.allowInsecureHttp === true || ai.allowInsecureHttp === true || allowPrivateHosts;

  return {
    task,
    language,
    labels: uniqueStrings(options.labels || input.labels),
    schema: isPlainObject(options.schema) ? options.schema : null,
    apiKey,
    baseUrl: normalizeBaseUrl(ai.baseUrl || options.baseUrl, DEFAULT_API_BASE_URL, allowPrivateHosts, allowInsecureHttp),
    model: String(ai.model || options.model || 'gpt-5.5').trim(),
    temperature: readNumber(ai.temperature ?? options.temperature, 0.2, 0, 2),
    maxTokens: readBoundedInt(ai.maxTokens ?? options.maxTokens, 256, 8192, 1600),
    timeoutMs: readBoundedInt(options.timeoutMs ?? ai.timeoutMs, 1000, 180000, 60000),
    retries: readBoundedInt(options.retries ?? ai.retries, 0, 4, 1),
    includeSources: output.includeSources !== false,
    maxCharacters: readBoundedInt(output.maxCharacters, 200, 20000, 4000)
  };
}

function collectDocuments(input, config) {
  const documents = [];
  const pushDocument = (raw, index) => {
    if (!raw) return;
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return;
      documents.push({
        id: `doc-${index + 1}`,
        title: truncate(text.split('\n')[0], 80),
        text: truncate(text, MAX_SOURCE_TEXT_CHARS),
        url: null
      });
      return;
    }
    if (typeof raw !== 'object') return;
    const nested = raw.data && typeof raw.data === 'object' ? raw.data : raw;
    const text = firstString(
      nested.text,
      nested.content,
      nested.body,
      nested.message,
      nested.summary,
      nested.articleText
    );
    if (!text) return;
    documents.push({
      id: String(nested.id || raw.id || `doc-${index + 1}`),
      title: firstString(nested.title, nested.name, nested.headline) || truncate(text.split('\n')[0], 80),
      text: truncate(text, MAX_SOURCE_TEXT_CHARS),
      url: firstString(nested.url, nested.href, nested.link, nested.source)
    });
  };

  if (Array.isArray(input.documents)) {
    input.documents.slice(0, MAX_DOCUMENTS).forEach(pushDocument);
  }
  if (Array.isArray(input.items)) {
    input.items.slice(0, MAX_DOCUMENTS).forEach(pushDocument);
  }
  if (input.data && Array.isArray(input.data.items)) {
    input.data.items.slice(0, MAX_DOCUMENTS).forEach(pushDocument);
  }
  if (documents.length === 0) {
    pushDocument(
      {
        title: input.title,
        text: firstString(input.text, input.content, input.body, input.prompt, input.message),
        url: input.url
      },
      0
    );
  }

  if (config.task === 'classify' && config.labels.length === 0) {
    throw Object.assign(new Error('Classification requires options.labels'), {
      code: 'DOCUMENT_LABELS_REQUIRED'
    });
  }
  if (config.task === 'extract' && !config.schema) {
    throw Object.assign(new Error('Extraction requires options.schema'), {
      code: 'DOCUMENT_SCHEMA_REQUIRED'
    });
  }

  return documents.slice(0, MAX_DOCUMENTS);
}

async function requestModel(documents, config) {
  const response = await requestWithRetry(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(config) },
          { role: 'user', content: JSON.stringify({ documents, task: config.task, labels: config.labels, schema: config.schema, language: config.language }) }
        ]
      })
    },
    config.timeoutMs,
    config.retries
  );

  if (!response.ok) {
    const bodyText = await readBoundedText(response, MAX_ERROR_BYTES, false);
    throw Object.assign(new Error(bodyText || `Document intelligence request failed (${response.status})`), {
      code: 'DOCUMENT_AI_REQUEST_FAILED',
      status: response.status
    });
  }

  const rawText = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw Object.assign(new Error('Document intelligence response is not valid JSON'), {
      code: 'DOCUMENT_AI_INVALID_JSON'
    });
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw Object.assign(new Error('The model returned an empty completion'), {
      code: 'DOCUMENT_AI_EMPTY'
    });
  }

  return {
    content,
    usage: normalizeUsage(payload.usage)
  };
}

function systemPrompt(config) {
  const language = config.language === 'en' ? 'English' : 'Simplified Chinese';
  return [
    'Return a JSON object only. Do not wrap it in markdown.',
    'Schema:',
    '{"title":"","body":"","labels":[{"name":"","confidence":0}],"fields":{},"sources":[{"title":"","url":""}]}',
    `Write title and body in ${language}.`,
    'Use only facts present in the supplied documents. Do not invent URLs.',
    config.task === 'summarize'
      ? 'Summarize the documents into a publishable briefing body with source citations.'
      : config.task === 'classify'
        ? `Classify the documents using only these labels: ${config.labels.join(', ')}.`
        : 'Extract fields that match the provided schema. Omit unknown fields rather than guessing.'
  ].join('\n');
}

function normalizeDeliverable(content, documents, config) {
  const parsed = parseJsonObject(content) || {};
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map(source => ({
          title: firstString(source?.title, source?.name) || firstString(source?.url),
          url: firstString(source?.url, source?.href)
        }))
        .filter(source => source.title)
    : documents
        .filter(document => document.url)
        .map(document => ({ title: document.title, url: document.url }));

  const labels = Array.isArray(parsed.labels)
    ? parsed.labels
        .map(label => ({
          name: firstString(label?.name, label?.label),
          confidence: readNumber(label?.confidence, 0, 0, 1)
        }))
        .filter(label => label.name)
    : [];

  return {
    title: firstString(parsed.title) || documents[0]?.title || defaultTitle(config),
    body: truncate(firstString(parsed.body, parsed.summary, parsed.message), config.maxCharacters),
    labels,
    fields: parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields) ? parsed.fields : {},
    sources
  };
}

function defaultTitle(config) {
  if (config.language === 'en') {
    return config.task === 'classify' ? 'Document classification' : config.task === 'extract' ? 'Extracted fields' : 'Document summary';
  }
  return config.task === 'classify' ? '文档分类' : config.task === 'extract' ? '抽取结果' : '文档摘要';
}

function formatPublishedMessage(deliverable, config) {
  const lines = [deliverable.title, '', deliverable.body];
  if (config.task === 'classify' && deliverable.labels.length) {
    lines.push(
      '',
      deliverable.labels.map(label => `${label.name} (${Math.round(label.confidence * 100)}%)`).join(', ')
    );
  }
  if (config.includeSources && deliverable.sources.length) {
    lines.push('', config.language === 'en' ? 'Sources' : '来源');
    deliverable.sources.forEach((source, index) => {
      lines.push(source.url ? `${index + 1}. ${source.title} · ${source.url}` : `${index + 1}. ${source.title}`);
    });
  }
  return truncate(lines.join('\n').trim(), config.maxCharacters);
}

function normalizeUsage(usage) {
  const promptTokens = Number(usage?.prompt_tokens || usage?.promptTokens || 0);
  const completionTokens = Number(usage?.completion_tokens || usage?.completionTokens || 0);
  const totalTokens = Number(usage?.total_tokens || usage?.totalTokens || promptTokens + completionTokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function buildFailure(error, startedAt, context, code, usage, config = null) {
  const safeMessage = redactErrorMessage(error?.message || 'Document intelligence failed', config, context);
  return {
    success: false,
    data: {
      items: [],
      summary: {
        total: 0,
        success_count: 0,
        failure_count: 1
      }
    },
    error: {
      message: safeMessage,
      code: code || error?.code || 'DOCUMENT_INTELLIGENCE_ERROR',
      type: error?.name || 'DocumentIntelligenceError'
    },
    metadata: {
      contract_version: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      execution_id: context?.execution_id || null,
      usage: usage || null,
      execution_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    },
    citations: []
  };
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
        throw Object.assign(new Error('HTTP redirects are not allowed'), {
          code: 'DOCUMENT_AI_REDIRECT_BLOCKED'
        });
      }
      if (response.ok || attempt >= retries || (![408, 409, 425, 429].includes(response.status) && response.status < 500)) {
        return response;
      }
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      await sleep(Math.min(500 * 2 ** attempt, 4000));
      attempt += 1;
    } catch (error) {
      if (error?.code === 'DOCUMENT_AI_REDIRECT_BLOCKED' || attempt >= retries) {
        if (error?.name === 'AbortError') {
          throw new Error(`Document intelligence request timed out after ${timeoutMs}ms`);
        }
        throw error;
      }
      await sleep(Math.min(500 * 2 ** attempt, 4000));
      attempt += 1;
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    }
  }
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
}

function normalizeBaseUrl(value, fallback, allowPrivateHosts, allowInsecureHttp) {
  const raw = String(value || fallback).trim();
  if (!raw) {
    throw new Error('baseUrl must not be empty');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('baseUrl must be a valid URL');
  }
  if (parsed.username || parsed.password) {
    throw new Error('baseUrl must not embed credentials');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error('baseUrl must use https unless allowInsecureHttp is enabled');
  }
  if (!allowPrivateHosts && isBlockedHost(parsed.hostname)) {
    throw new Error('baseUrl must not point to a private or internal host');
  }
  return parsed.toString().replace(/\/+$/, '');
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

function redactErrorMessage(message, config, context) {
  let safe = String(message || 'Document intelligence failed');
  const secrets = [
    config?.apiKey,
    context?.secrets?.OPENAI_API_KEY,
    context?.secrets?.DOCUMENT_INTELLIGENCE_API_KEY
  ];
  for (const secret of secrets) {
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
            throw new Error(`Document intelligence response exceeds ${maxBytes} byte limit`);
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
  const text = await response.text();
  if (typeof text === 'string' && text.length > maxBytes) {
    if (throwOnLimit) {
      throw new Error(`Document intelligence response exceeds ${maxBytes} byte limit`);
    }
    return text.slice(0, maxBytes);
  }
  return text || '';
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

function parseJsonObject(content) {
  const trimmed = String(content || '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Continue with a bounded object slice.
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function truncate(value, maxChars) {
  const text = String(value || '');
  if ([...text].length <= maxChars) return text;
  return `${[...text].slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

function readNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function readBoundedInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;
