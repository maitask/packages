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

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();

  try {
    ensureFetch();
    const config = buildConfig(input, options, context);
    const documents = collectDocuments(input, config);
    if (!documents.length) {
      return buildFailure(
        new Error('Provide text, documents, or upstream items with readable content'),
        startedAt,
        context,
        'DOCUMENT_INPUT_REQUIRED'
      );
    }

    const result = await requestModel(documents, config);
    const deliverable = normalizeDeliverable(result.content, documents, config);
    if (!deliverable.body) {
      return buildFailure(
        new Error('The model did not return a publishable document result'),
        startedAt,
        context,
        'DOCUMENT_OUTPUT_INVALID',
        result.usage
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
        execution_id: context?.execution_id || null,
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
    return buildFailure(error, startedAt, context);
  }
}

function buildConfig(input, options, context) {
  const ai = options.ai && typeof options.ai === 'object' ? options.ai : {};
  const output = options.output && typeof options.output === 'object' ? options.output : {};
  const apiKey =
    ai.apiKey ||
    ai.api_key ||
    options.apiKey ||
    options.api_key ||
    context?.secrets?.OPENAI_API_KEY ||
    context?.secrets?.DOCUMENT_INTELLIGENCE_API_KEY;
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

  return {
    task,
    language,
    labels: uniqueStrings(options.labels || input.labels),
    schema: options.schema && typeof options.schema === 'object' ? options.schema : null,
    apiKey,
    baseUrl: normalizeBaseUrl(ai.baseUrl || options.baseUrl, DEFAULT_API_BASE_URL),
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
    const bodyText = await response.text().catch(() => '');
    throw Object.assign(new Error(bodyText || `Document intelligence request failed (${response.status})`), {
      code: 'DOCUMENT_AI_REQUEST_FAILED',
      status: response.status
    });
  }

  const payload = await response.json();
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

function buildFailure(error, startedAt, context, code, usage) {
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
      message: error?.message || 'Document intelligence failed',
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
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || attempt >= retries || ![408, 409, 425, 429].includes(response.status) && response.status < 500) {
        return response;
      }
      await sleep(Math.min(500 * 2 ** attempt, 4000));
      attempt += 1;
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(Math.min(500 * 2 ** attempt, 4000));
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
}

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback).trim().replace(/\/+$/, '');
  return raw || fallback;
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
