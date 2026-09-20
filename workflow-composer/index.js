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

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();

  try {
    ensureFetch();
    const config = buildConfig(input, options, context);
    const catalog = normalizeCatalog(input.catalog || options.catalog);
    if (!catalog.length) {
      return fail('Official package catalog is required', startedAt, context, 'WORKFLOW_CATALOG_REQUIRED');
    }

    const modelResult = await requestModel(config, catalog);
    const draft = normalizeDraft(modelResult.content, config, catalog);
    const validation = validateDraftGraph(draft, catalog);
    if (!validation.ok) {
      return fail(validation.message, startedAt, context, 'WORKFLOW_DRAFT_INVALID', modelResult.usage);
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
        execution_id: context?.execution_id || null,
        language: config.language,
        model: config.model,
        usage: modelResult.usage,
        execution_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      },
      citations: []
    };
  } catch (error) {
    return fail(error.message || 'Workflow composer failed', startedAt, context, error.code || 'WORKFLOW_COMPOSER_ERROR');
  }
}

function buildConfig(input, options, context) {
  const apiKey =
    options.apiKey ||
    options.api_key ||
    options.ai?.apiKey ||
    context?.secrets?.OPENAI_API_KEY ||
    context?.secrets?.WORKFLOW_COMPOSER_API_KEY;
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

  return {
    description,
    language,
    apiKey,
    baseUrl: normalizeBaseUrl(options.baseUrl || options.ai?.baseUrl, DEFAULT_API_BASE_URL),
    model: String(options.model || options.ai?.model || 'gpt-5.5').trim(),
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
    const bodyText = await response.text().catch(() => '');
    const error = new Error(bodyText || `Workflow composer request failed (${response.status})`);
    error.code = 'WORKFLOW_COMPOSER_REQUEST_FAILED';
    throw error;
  }

  const payload = await response.json();
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

function fail(message, startedAt, context, code, usage) {
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
      message,
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
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || attempt >= retries || (response.status < 500 && ![408, 409, 425, 429].includes(response.status))) {
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
  return String(value || fallback).trim().replace(/\/+$/, '') || fallback;
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
