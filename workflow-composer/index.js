/**
 * @maitask/workflow-composer
 * Fail-closed workflow graph generation from a description and official catalog.
 */

const PACKAGE_NAME = '@maitask/workflow-composer';
const PACKAGE_VERSION = '1.0.0';
const CONTRACT_VERSION = '2026-06-27';
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const SUPPORTED_NODE_TYPES = new Set([
  'trigger-manual',
  'trigger-webhook',
  'trigger-message',
  'trigger-event',
  'package',
  'agent',
  'condition',
  'switch',
  'variable',
  'transform',
  'http',
  'adapter',
  'notification',
  'delay',
  'log',
  'completion',
  'group',
  'note'
]);

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
    const catalog = normalizeCatalog(safeInput.catalog || safeOptions.catalog);
    if (!catalog.length) {
      return fail('Official package catalog is required', startedAt, safeContext, 'WORKFLOW_CATALOG_REQUIRED', null, config);
    }

    const modelResult = await requestModel(config, catalog);
    const draft = normalizeDraft(modelResult.content, config, catalog);
    const validation = validateDraftGraph(draft, catalog);
    if (!validation.ok) {
      return fail(validation.message, startedAt, safeContext, 'WORKFLOW_DRAFT_INVALID', modelResult.usage, config);
    }

    return {
      success: true,
      data: {
        items: [
          {
            index: 0,
            id: 'workflow-draft',
            data: {
              name: draft.name,
              description: draft.description,
              nodes: draft.nodes,
              edges: draft.edges,
              notes: draft.notes,
              warnings: draft.warnings
            },
            metadata: {
              language: config.language,
              model: config.model
            },
            citation_ids: []
          }
        ],
        summary: {
          total: 1,
          success_count: 1,
          failure_count: 0,
          metrics: {
            nodes: draft.nodes.length,
            edges: draft.edges.length,
            packages: countPackageNodes(draft.nodes)
          }
        },
        name: draft.name,
        description: draft.description,
        nodes: draft.nodes,
        edges: draft.edges,
        notes: draft.notes,
        warnings: draft.warnings,
        usage: modelResult.usage
      },
      error: null,
      metadata: {
        contract_version: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        execution_id: safeContext?.execution_id || null,
        language: config.language,
        model: config.model,
        usage: modelResult.usage,
        execution_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      },
      citations: []
    };
  } catch (error) {
    return fail(error.message || 'Workflow composer failed', startedAt, context, error.code || 'WORKFLOW_COMPOSER_ERROR', null, config);
  }
}

function buildConfig(input, options, context) {
  const ai = isPlainObject(options.ai) ? options.ai : {};
  const apiKey = firstString(
    options.apiKey,
    ai.apiKey,
    context?.secrets?.OPENAI_API_KEY,
    context?.secrets?.WORKFLOW_COMPOSER_API_KEY
  );
  if (!apiKey) {
    const error = new Error('AI API key is required');
    error.code = 'WORKFLOW_COMPOSER_KEY_REQUIRED';
    throw error;
  }

  const description = String(input.description || input.prompt || input.goal || '').trim();
  if (!description) {
    const error = new Error('Workflow description is required');
    error.code = 'WORKFLOW_DESCRIPTION_REQUIRED';
    throw error;
  }

  const language = String(options.language || input.language || 'zh-CN').trim();
  if (language !== 'zh-CN' && language !== 'en') {
    const error = new Error('Language must be zh-CN or en');
    error.code = 'WORKFLOW_LANGUAGE_INVALID';
    throw error;
  }

  const allowPrivateHosts = options.allowPrivateHosts === true || ai.allowPrivateHosts === true;
  const allowInsecureHttp = options.allowInsecureHttp === true || ai.allowInsecureHttp === true || allowPrivateHosts;

  return {
    description,
    language,
    apiKey,
    baseUrl: normalizeBaseUrl(options.baseUrl || ai.baseUrl, DEFAULT_API_BASE_URL, allowPrivateHosts, allowInsecureHttp),
    model: String(options.model || ai.model || 'gpt-5.5').trim(),
    temperature: clampNumber(options.temperature, 0, 2, 0.2),
    maxTokens: clampInt(options.maxTokens, 512, 8192, 3500),
    timeoutMs: clampInt(options.timeoutMs, 1000, 180000, 90000),
    retries: clampInt(options.retries, 0, 3, 1)
  };
}

function normalizeCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || item.package_name || '').trim();
      if (!name) return null;
      return {
        name,
        version: String(item.version || item.latest_version || '').trim(),
        description: String(item.description || '').trim(),
        category: String(item.category || '').trim(),
        input_fields: Array.isArray(item.input_fields) ? item.input_fields : [],
        option_fields: Array.isArray(item.option_fields) ? item.option_fields : []
      };
    })
    .filter(Boolean);
}

async function requestModel(config, catalog) {
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
          { role: 'system', content: systemPrompt(config, catalog) },
          {
            role: 'user',
            content: JSON.stringify({
              description: config.description,
              language: config.language,
              catalog
            })
          }
        ]
      })
    },
    config.timeoutMs,
    config.retries
  );

  if (!response.ok) {
    const bodyText = await readBoundedText(response, MAX_ERROR_BYTES, false);
    const error = new Error(bodyText || `Workflow composer request failed (${response.status})`);
    error.code = 'WORKFLOW_COMPOSER_REQUEST_FAILED';
    throw error;
  }

  const rawText = await readBoundedText(response, MAX_RESPONSE_BYTES, true);
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    const error = new Error('Workflow composer response is not valid JSON');
    error.code = 'WORKFLOW_COMPOSER_INVALID_JSON';
    throw error;
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    const error = new Error('The model returned an empty workflow draft');
    error.code = 'WORKFLOW_COMPOSER_EMPTY';
    throw error;
  }

  return {
    content,
    usage: normalizeUsage(payload.usage)
  };
}

function systemPrompt(config, catalog) {
  const language = config.language === 'en' ? 'English' : 'Simplified Chinese';
  const catalogNames = catalog.map(item => item.name).join(', ');
  return [
    'Return a JSON object only. Do not wrap it in markdown.',
    'Schema:',
    '{"name":"","description":"","notes":"","warnings":[],"nodes":[],"edges":[]}',
    `Write name, description, and notes in ${language}.`,
    'The graph must be a Maitask workflow:',
    '- Include exactly one trigger node: trigger-manual, trigger-webhook, trigger-message, or trigger-event.',
    '- Include a completion node.',
    '- Package nodes must set type "package" and data.package_name from the official catalog only.',
    '- Agent nodes must set type "agent", data.goal_source, data.language, data.max_steps (1-12), and data.allowed_packages using catalog package names.',
    '- Do not invent packages, credentials, adapter identifiers, or webhook secrets.',
    '- Leave secrets, adapter_id, and API keys empty so a human can fill them.',
    '- Prefer a package pipeline when the description maps to known packages. Use an agent node only when the work needs a bounded tool loop.',
    '- Supported node types: trigger-manual, trigger-webhook, trigger-message, trigger-event, package, agent, condition, switch, variable, transform, http, adapter, notification, delay, log, completion, group, note.',
    `- Official catalog: ${catalogNames}`
  ].join('\n');
}

function normalizeDraft(content, config, catalog) {
  const parsed = parseJsonObject(content) || {};
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.map(normalizeNode).filter(Boolean) : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges.map(normalizeEdge).filter(Boolean) : [];
  const catalogNames = new Set(catalog.map(item => item.name));
  const warnings = uniqueStrings([
    ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
    ...collectDraftWarnings(nodes, catalogNames, config)
  ]);

  return {
    name: firstString(parsed.name) || defaultName(config),
    description: firstString(parsed.description) || config.description,
    notes: firstString(parsed.notes),
    warnings,
    nodes,
    edges
  };
}

function normalizeNode(node, index) {
  if (!node || typeof node !== 'object') return null;
  const type = String(node.type || '').trim();
  if (!SUPPORTED_NODE_TYPES.has(type)) return null;
  const id = String(node.id || `${type}-${index + 1}`).trim();
  const position = node.position && typeof node.position === 'object'
    ? {
        x: Number(node.position.x) || index * 280,
        y: Number(node.position.y) || 120
      }
    : { x: index * 280, y: 120 };
  const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data) ? { ...node.data } : {};
  if (!data.label) {
    data.label = type;
  }
  delete data.ai?.apiKey;
  delete data.config?.apiKey;
  return { id, type, position, data };
}

function normalizeEdge(edge, index) {
  if (!edge || typeof edge !== 'object') return null;
  const source = String(edge.source || '').trim();
  const target = String(edge.target || '').trim();
  if (!source || !target) return null;
  const normalized = {
    id: String(edge.id || `e-${index + 1}`).trim(),
    source,
    target
  };
  if (edge.sourceHandle) normalized.sourceHandle = String(edge.sourceHandle);
  if (edge.targetHandle) normalized.targetHandle = String(edge.targetHandle);
  return normalized;
}

function validateDraftGraph(draft, catalog) {
  if (!Array.isArray(draft.nodes) || draft.nodes.length < 2) {
    return { ok: false, message: 'Workflow draft must include at least a trigger and another node' };
  }
  const triggerCount = draft.nodes.filter(node => String(node.type).startsWith('trigger-')).length;
  if (triggerCount !== 1) {
    return { ok: false, message: 'Workflow draft must include exactly one trigger node' };
  }
  if (!draft.nodes.some(node => node.type === 'completion')) {
    return { ok: false, message: 'Workflow draft must include a completion node' };
  }

  const catalogNames = new Set(catalog.map(item => item.name));
  const nodeIds = new Set();
  for (const node of draft.nodes) {
    if (!node.id || nodeIds.has(node.id)) {
      return { ok: false, message: `Workflow draft node id '${node.id || ''}' is missing or duplicated` };
    }
    nodeIds.add(node.id);
    if (node.type === 'package') {
      const packageName = String(node.data?.package_name || '').trim();
      if (!packageName || !catalogNames.has(packageName)) {
        return { ok: false, message: `Workflow draft uses a package that is not in the official catalog: ${packageName || '(empty)'}` };
      }
    }
    if (node.type === 'agent') {
      const allowed = Array.isArray(node.data?.allowed_packages) ? node.data.allowed_packages : [];
      if (!allowed.length) {
        return { ok: false, message: 'Agent nodes in a draft must allow at least one catalog package' };
      }
      for (const item of allowed) {
        const name = typeof item === 'string' ? item : item?.package_name || item?.name;
        if (!catalogNames.has(String(name || '').trim())) {
          return { ok: false, message: `Agent allowlist includes a package that is not in the official catalog: ${name || '(empty)'}` };
        }
      }
    }
  }

  for (const edge of draft.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return { ok: false, message: `Workflow draft edge '${edge.id}' references an unknown node` };
    }
  }

  return { ok: true };
}

function collectDraftWarnings(nodes, catalogNames, config) {
  const warnings = [];
  if (nodes.some(node => node.type === 'adapter' && !node.data?.adapter_id)) {
    warnings.push(config.language === 'en' ? 'Select a saved adapter before publishing.' : '发布前请选择已保存的适配器。');
  }
  if (nodes.some(node => node.type === 'agent' && !node.data?.ai?.apiKey)) {
    warnings.push(config.language === 'en' ? 'Configure the agent model credentials before publishing.' : '发布前请配置 Agent 的模型凭证。');
  }
  if (nodes.some(node => node.type === 'package' && looksLikeAiPackage(node.data?.package_name) && !node.data?.config?.apiKey && !node.data?.config?.ai?.apiKey)) {
    warnings.push(config.language === 'en' ? 'Configure package model credentials before publishing.' : '发布前请配置包节点的模型凭证。');
  }
  return warnings;
}

function looksLikeAiPackage(name) {
  return [
    '@maitask/openai',
    '@maitask/claude',
    '@maitask/gemini',
    '@maitask/deepseek',
    '@maitask/ollama',
    '@maitask/intelligence-briefing',
    '@maitask/document-intelligence',
    '@maitask/workflow-composer'
  ].includes(String(name || ''));
}

function countPackageNodes(nodes) {
  return nodes.filter(node => node.type === 'package' || node.type === 'agent').length;
}

function defaultName(config) {
  return config.language === 'en' ? 'Generated workflow' : '生成的工作流';
}

function fail(message, startedAt, context, code, usage, config = null) {
  const safeMessage = redactErrorMessage(message, config, context);
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
      code,
      type: 'WorkflowComposerError'
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

function normalizeUsage(usage) {
  const promptTokens = Number(usage?.prompt_tokens || usage?.promptTokens || 0);
  const completionTokens = Number(usage?.completion_tokens || usage?.completionTokens || 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Number(usage?.total_tokens || usage?.totalTokens || promptTokens + completionTokens),
    promptTokens,
    completionTokens,
    totalTokens: Number(usage?.total_tokens || usage?.totalTokens || promptTokens + completionTokens)
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
        const error = new Error('HTTP redirects are not allowed');
        error.code = 'WORKFLOW_COMPOSER_REDIRECT_BLOCKED';
        throw error;
      }
      if (response.ok || attempt >= retries || (response.status < 500 && ![408, 409, 425, 429].includes(response.status))) {
        return response;
      }
      if (response?.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch {}
      }
      await sleep(Math.min(500 * 2 ** attempt, 4000));
      attempt += 1;
    } catch (error) {
      if (error?.code === 'WORKFLOW_COMPOSER_REDIRECT_BLOCKED' || attempt >= retries) {
        if (error?.name === 'AbortError') {
          throw new Error(`Workflow composer request timed out after ${timeoutMs}ms`);
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
  let safe = String(message || 'Workflow composer failed');
  const secrets = [
    config?.apiKey,
    context?.secrets?.OPENAI_API_KEY,
    context?.secrets?.WORKFLOW_COMPOSER_API_KEY
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
            throw new Error(`Workflow composer response exceeds ${maxBytes} byte limit`);
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
      throw new Error(`Workflow composer response exceeds ${maxBytes} byte limit`);
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

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function firstString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;
