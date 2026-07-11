/**
 * @maitask/email-sender
 * Strict SendGrid and Mailgun delivery client for Maitask Runtime.
 */

const PACKAGE_NAME = '@maitask/email-sender';
const PACKAGE_VERSION = '1.0.0';
const CONTRACT_VERSION = '2026-07-11';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_SENDGRID_BASE_URL = 'https://api.sendgrid.com';
const DEFAULT_MAILGUN_BASE_URL = 'https://api.mailgun.net';
const INPUT_FIELDS = new Set([
  'provider', 'from', 'to', 'cc', 'bcc', 'replyTo', 'subject', 'content', 'template',
  'providerTemplate', 'attachments', 'headers', 'tags', 'metadata'
]);
const OPTION_FIELDS = new Set([
  'baseUrl', 'domain', 'apiKeySecret', 'timeoutMs', 'maxResponseBytes',
  'allowInsecureHttp', 'secrets'
]);
const ADDRESS_FIELDS = new Set(['email', 'name']);
const CONTENT_FIELDS = new Set(['text', 'html']);
const TEMPLATE_FIELDS = new Set(['text', 'html', 'variables']);
const PROVIDER_TEMPLATE_FIELDS = new Set(['id', 'variables']);
const ATTACHMENT_FIELDS = new Set([
  'filename', 'contentType', 'bodyBase64', 'disposition', 'contentId'
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RECIPIENTS = 1000;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

class EmailFailure extends Error {
  constructor(code, message, type, properties = {}) {
    super(message);
    this.name = type;
    this.code = code;
    this.type = type;
    if (properties.status !== undefined) this.status = properties.status;
    if (properties.retriable !== undefined) this.retriable = properties.retriable;
  }
}

async function execute(rawInput, rawOptions = {}, rawContext = {}) {
  const startedAt = Date.now();
  let config = null;
  let attempts = 0;
  try {
    ensureTransport();
    config = buildConfig(rawInput, rawOptions, rawContext);
    attempts = 1;
    const response = await deliver(config);
    const messageId = extractMessageId(config.provider, response);
    return buildSuccess(config, response.status, messageId, startedAt);
  } catch (error) {
    const failure = normalizeFailure(error);
    return {
      success: false,
      error: failure,
      metadata: {
        contractVersion: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        provider: config ? config.provider : readSafeProvider(rawInput),
        executionId: config ? config.executionId : readSafeExecutionId(rawContext),
        attempts,
        executedAt: new Date().toISOString(),
        executionMs: Date.now() - startedAt
      },
      citations: []
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;

function buildConfig(rawInput, rawOptions, rawContext) {
  const input = snapshotKnownRecord(rawInput, INPUT_FIELDS);
  const options = snapshotKnownRecord(rawOptions, OPTION_FIELDS);
  const context = readContext(rawContext);
  const optionSecrets = options.secrets === undefined ? Object.create(null) : snapshotSecrets(options.secrets);
  const provider = requiredEnum(input.provider, ['sendgrid', 'mailgun']);
  const allowInsecureHttp = optionalBoolean(options.allowInsecureHttp, false);
  const defaultBaseUrl = provider === 'sendgrid' ? DEFAULT_SENDGRID_BASE_URL : DEFAULT_MAILGUN_BASE_URL;
  const baseUrl = normalizeBaseUrl(optionalString(options.baseUrl, defaultBaseUrl, 2048), allowInsecureHttp);
  const apiKeySecret = options.apiKeySecret === undefined
    ? provider === 'sendgrid' ? 'SENDGRID_API_KEY' : 'MAILGUN_API_KEY'
    : requiredSecretName(options.apiKeySecret);
  const apiKey = resolveSecret(apiKeySecret, optionSecrets, context.secrets);
  validateCredential(apiKey);
  const domain = provider === 'mailgun' ? normalizeMailgunDomain(options.domain) : rejectUnusedDomain(options.domain);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 120_000);
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    1024 * 1024
  );
  const message = normalizeMessage(input, provider);

  return {
    provider,
    baseUrl,
    apiKey,
    domain,
    timeoutMs,
    maxResponseBytes,
    executionId: context.executionId,
    ...message
  };
}

function normalizeMessage(input, provider) {
  const from = normalizeAddress(input.from, 'from');
  const to = normalizeRecipientList(input.to, 'to');
  const cc = normalizeRecipientList(input.cc, 'cc');
  const bcc = normalizeRecipientList(input.bcc, 'bcc');
  const recipientCount = to.length + cc.length + bcc.length;
  if (recipientCount === 0 || recipientCount > MAX_RECIPIENTS) throw validationFailure();
  const seen = new Set();
  for (const recipient of [...to, ...cc, ...bcc]) {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) throw validationFailure();
    seen.add(key);
  }
  const replyTo = input.replyTo === undefined ? null : normalizeAddress(input.replyTo, 'replyTo');
  const contentModeCount = ['content', 'template', 'providerTemplate']
    .filter(field => input[field] !== undefined).length;
  if (contentModeCount !== 1) throw validationFailure();

  let content = null;
  let providerTemplate = null;
  let templateMode = 'none';
  if (input.content !== undefined) {
    content = normalizeContent(input.content);
  } else if (input.template !== undefined) {
    content = renderLocalTemplate(input.template);
    templateMode = 'local';
  } else {
    providerTemplate = normalizeProviderTemplate(input.providerTemplate);
    templateMode = 'provider';
  }
  const subject = input.subject === undefined ? null : normalizeHeaderText(input.subject, 998, false);
  if (!providerTemplate && !subject) throw validationFailure();

  return {
    from,
    to,
    cc,
    bcc,
    replyTo,
    recipientCount,
    subject,
    content,
    providerTemplate,
    templateMode,
    attachments: normalizeAttachments(input.attachments, provider),
    headers: normalizeMessageHeaders(input.headers),
    tags: normalizeTags(input.tags, provider),
    metadata: normalizeMetadata(input.metadata)
  };
}

function normalizeAddress(value, _field) {
  const address = snapshotKnownRecord(value, ADDRESS_FIELDS);
  const email = normalizeEmail(address.email);
  const name = address.name === undefined ? null : normalizeHeaderText(address.name, 256, true);
  return { email, ...(name ? { name } : {}) };
}

function normalizeRecipientList(value, _field) {
  if (value === undefined) return [];
  const items = snapshotArray(value);
  return items.map(item => normalizeAddress(item, 'recipient'));
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw validationFailure();
  const email = value.trim();
  if (!email || email.length > 254 || /[\r\n\0]/.test(email)) throw validationFailure();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1 || email.indexOf('@') !== at) throw validationFailure();
  const local = email.slice(0, at);
  const rawDomain = email.slice(at + 1);
  if (local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    throw validationFailure();
  }
  let parsed;
  try { parsed = new URL(`http://${rawDomain}/`); } catch { throw validationFailure(); }
  const domain = parsed.hostname.toLowerCase();
  if (!domain || parsed.port || parsed.pathname !== '/' || parsed.username || parsed.password ||
      !domain.split('.').every(label => label && label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw validationFailure();
  }
  return `${local}@${domain}`;
}

function normalizeContent(value) {
  const content = snapshotKnownRecord(value, CONTENT_FIELDS);
  const text = content.text === undefined ? null : normalizeContentString(content.text);
  const html = content.html === undefined ? null : normalizeContentString(content.html);
  if (!text && !html) throw validationFailure();
  return { text, html };
}

function renderLocalTemplate(value) {
  const template = snapshotKnownRecord(value, TEMPLATE_FIELDS);
  const variables = template.variables === undefined
    ? Object.create(null)
    : snapshotJsonRecord(template.variables);
  const textSource = template.text === undefined ? null : normalizeContentString(template.text);
  const htmlSource = template.html === undefined ? null : normalizeContentString(template.html);
  if (!textSource && !htmlSource) throw validationFailure();
  return {
    text: textSource ? interpolateTemplate(textSource, variables, false) : null,
    html: htmlSource ? interpolateTemplate(htmlSource, variables, true) : null
  };
}

function interpolateTemplate(source, variables, escapeHtmlValues) {
  const result = source.replace(/{{\s*([A-Za-z_][A-Za-z0-9_.]{0,255})\s*}}/g, (_match, path) => {
    const value = resolveTemplateValue(variables, path);
    if (value === undefined || (value !== null && typeof value === 'object')) throw validationFailure();
    const rendered = value === null ? '' : String(value);
    return escapeHtmlValues ? escapeHtml(rendered) : rendered;
  });
  if (result.includes('{{') || result.includes('}}')) throw validationFailure();
  return result;
}

function resolveTemplateValue(variables, path) {
  let current = variables;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || !hasOwn(current, segment)) {
      throw validationFailure();
    }
    current = current[segment];
  }
  return current;
}

function normalizeProviderTemplate(value) {
  const template = snapshotKnownRecord(value, PROVIDER_TEMPLATE_FIELDS);
  return {
    id: normalizeHeaderText(template.id, 256, false),
    variables: template.variables === undefined
      ? Object.create(null)
      : snapshotJsonRecord(template.variables)
  };
}

function normalizeAttachments(value, provider) {
  if (value === undefined) return [];
  const items = snapshotArray(value);
  if (items.length > MAX_ATTACHMENTS) throw validationFailure();
  let totalBytes = 0;
  return items.map(item => {
    const attachment = snapshotKnownRecord(item, ATTACHMENT_FIELDS);
    const filename = normalizeHeaderText(attachment.filename, 1024, false);
    const contentType = normalizeContentType(attachment.contentType);
    if (typeof attachment.bodyBase64 !== 'string' || !isCanonicalBase64(attachment.bodyBase64)) {
      throw validationFailure();
    }
    const bytes = base64ToBytes(attachment.bodyBase64);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw validationFailure();
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw validationFailure();
    const disposition = optionalEnum(attachment.disposition, ['attachment', 'inline'], 'attachment');
    const contentId = attachment.contentId === undefined
      ? null
      : normalizeHeaderText(attachment.contentId, 998, false);
    if (disposition === 'inline' && !contentId) throw validationFailure();
    if (disposition === 'attachment' && contentId) throw validationFailure();
    if (provider === 'mailgun' && disposition === 'inline' && contentId !== filename) {
      throw validationFailure();
    }
    return {
      filename,
      contentType,
      bodyBase64: attachment.bodyBase64,
      bytes,
      disposition,
      contentId
    };
  });
}

function normalizeMessageHeaders(value) {
  if (value === undefined) return Object.create(null);
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  let count = 0;
  for (const [name, rawValue] of Object.entries(record)) {
    if (!/^X-[A-Za-z0-9][A-Za-z0-9-]{0,126}$/.test(name) ||
        name.toLowerCase() === 'x-smtpapi' || name.toLowerCase() === 'x-mailgun-variables' ||
        typeof rawValue !== 'string' || rawValue.length > 4096 || /[\r\n\0]/.test(rawValue)) {
      throw validationFailure();
    }
    const lower = name.toLowerCase();
    if (Object.keys(result).some(existing => existing.toLowerCase() === lower)) throw validationFailure();
    count += 1;
    if (count > 50) throw validationFailure();
    result[name] = rawValue;
  }
  return result;
}

function normalizeTags(value, provider) {
  if (value === undefined) return [];
  const items = snapshotArray(value);
  if (items.length > (provider === 'mailgun' ? 3 : 10)) throw validationFailure();
  const seen = new Set();
  return items.map(item => {
    const tag = normalizeHeaderText(item, 128, false);
    if (seen.has(tag)) throw validationFailure();
    seen.add(tag);
    return tag;
  });
}

function normalizeMetadata(value) {
  if (value === undefined) return Object.create(null);
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  const entries = Object.entries(record);
  if (entries.length > 50) throw validationFailure();
  let totalBytes = 0;
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) ||
        typeof item !== 'string' || item.length > 1024 || /[\r\n\0]/.test(item)) {
      throw validationFailure();
    }
    totalBytes += encodeUtf8(key).byteLength + encodeUtf8(item).byteLength;
    if (totalBytes > 10 * 1024) throw validationFailure();
    result[key] = item;
  }
  return result;
}

async function deliver(config) {
  const request = config.provider === 'sendgrid'
    ? buildSendGridRequest(config)
    : buildMailgunRequest(config);
  const response = await requestProvider(request, config);
  if (REDIRECT_STATUSES.has(response.status)) throw redirectFailure();
  if (response.status < 200 || response.status >= 300) throw providerFailure(response.status);
  return response;
}

function buildSendGridRequest(config) {
  const personalization = { to: config.to };
  if (config.cc.length) personalization.cc = config.cc;
  if (config.bcc.length) personalization.bcc = config.bcc;
  if (Object.keys(config.headers).length) personalization.headers = config.headers;
  if (Object.keys(config.metadata).length) personalization.custom_args = config.metadata;
  if (config.providerTemplate) personalization.dynamic_template_data = config.providerTemplate.variables;
  const payload = {
    personalizations: [personalization],
    from: config.from
  };
  if (config.replyTo) payload.reply_to = config.replyTo;
  if (config.subject) payload.subject = config.subject;
  if (config.content) {
    payload.content = [];
    if (config.content.text) payload.content.push({ type: 'text/plain', value: config.content.text });
    if (config.content.html) payload.content.push({ type: 'text/html', value: config.content.html });
  }
  if (config.providerTemplate) payload.template_id = config.providerTemplate.id;
  if (config.attachments.length) {
    payload.attachments = config.attachments.map(attachment => ({
      content: attachment.bodyBase64,
      filename: attachment.filename,
      type: attachment.contentType,
      disposition: attachment.disposition,
      ...(attachment.contentId ? { content_id: attachment.contentId } : {})
    }));
  }
  if (config.tags.length) payload.categories = config.tags;
  const serialized = JSON.stringify(payload);
  if (encodeUtf8(serialized).byteLength > 30 * 1024 * 1024) throw validationFailure();
  return {
    url: `${config.baseUrl}/v3/mail/send`,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json; charset=utf-8',
      'user-agent': `${PACKAGE_NAME}/${PACKAGE_VERSION}`
    },
    body: { kind: 'text', value: serialized }
  };
}

function buildMailgunRequest(config) {
  const parts = [];
  appendField(parts, 'from', formatMailbox(config.from));
  for (const recipient of config.to) appendField(parts, 'to', formatMailbox(recipient));
  for (const recipient of config.cc) appendField(parts, 'cc', formatMailbox(recipient));
  for (const recipient of config.bcc) appendField(parts, 'bcc', formatMailbox(recipient));
  if (config.replyTo) appendField(parts, 'h:Reply-To', formatMailbox(config.replyTo));
  if (config.subject) appendField(parts, 'subject', config.subject);
  if (config.content) {
    if (config.content.text) appendField(parts, 'text', config.content.text);
    if (config.content.html) appendField(parts, 'html', config.content.html);
  }
  if (config.providerTemplate) {
    appendField(parts, 'template', config.providerTemplate.id);
    appendField(parts, 'h:X-Mailgun-Variables', JSON.stringify(config.providerTemplate.variables));
  }
  for (const [name, value] of Object.entries(config.headers)) appendField(parts, `h:${name}`, value);
  for (const tag of config.tags) appendField(parts, 'o:tag', tag);
  for (const [name, value] of Object.entries(config.metadata)) appendField(parts, `v:${name}`, value);
  for (const attachment of config.attachments) {
    parts.push({
      name: attachment.disposition === 'inline' ? 'inline' : 'attachment',
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: attachment.bytes
    });
  }
  const multipart = encodeMultipart(parts);
  return {
    url: `${config.baseUrl}/v3/${encodeURIComponent(config.domain)}/messages`,
    headers: {
      authorization: `Basic ${encodeUtf8Base64(`api:${config.apiKey}`)}`,
      'content-type': `multipart/form-data; boundary=${multipart.boundary}`,
      'user-agent': `${PACKAGE_NAME}/${PACKAGE_VERSION}`
    },
    body: { kind: 'bytes', bytes: multipart.bytes }
  };
}

function appendField(parts, name, value) {
  parts.push({ name, value: String(value) });
}

function encodeMultipart(parts) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const boundary = `maitask-${randomHex(24)}`;
    const marker = encodeUtf8(boundary);
    if (parts.some(part => part.bytes && containsBytes(part.bytes, marker))) continue;
    const chunks = [];
    let total = 0;
    const append = value => {
      const bytes = typeof value === 'string' ? encodeUtf8(value) : value;
      total += bytes.byteLength;
      if (total > 30 * 1024 * 1024) throw validationFailure();
      chunks.push(bytes);
    };
    for (const part of parts) {
      append(`--${boundary}\r\n`);
      if (part.bytes) {
        append(
          `Content-Disposition: form-data; name="${escapeQuoted(part.name)}"; ` +
          `filename="${escapeQuoted(asciiFilename(part.filename))}"; ` +
          `filename*=UTF-8''${encodeRfc5987(part.filename)}\r\n`
        );
        append(`Content-Type: ${part.contentType}\r\n\r\n`);
        append(part.bytes);
        append('\r\n');
      } else {
        append(`Content-Disposition: form-data; name="${escapeQuoted(part.name)}"\r\n\r\n`);
        append(part.value);
        append('\r\n');
      }
    }
    append(`--${boundary}--\r\n`);
    return { boundary, bytes: concatenateBytes(chunks, total) };
  }
  throw validationFailure();
}

async function requestProvider(request, config) {
  if (hasRuntimeHttpOperation()) return requestViaRuntime(request, config);
  return requestViaFetch(request, config);
}

async function requestViaRuntime(request, config) {
  let timer;
  try {
    const operation = globalThis.Deno.core.ops.op_http_request(request.url, {
      method: 'POST',
      headers: request.headers,
      ...(request.body.kind === 'text'
        ? { body: request.body.value }
        : { bodyBase64: bytesToBase64(request.body.bytes) }),
      redirect: 'manual',
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes
    });
    const raw = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutFailure()), config.timeoutMs);
      })
    ]);
    return normalizeRuntimeResponse(raw, config.maxResponseBytes);
  } catch (error) {
    if (error instanceof EmailFailure) throw error;
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function requestViaFetch(request, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body.kind === 'text' ? request.body.value : request.body.bytes,
      redirect: 'manual',
      signal: controller.signal,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes
    });
    const headers = normalizeResponseHeaders(response.headers);
    const bytes = await readResponseBytes(response, config.maxResponseBytes, controller);
    return { status: normalizeStatus(response.status), headers, bytes };
  } catch (error) {
    if (error instanceof EmailFailure) throw error;
    if (controller.signal.aborted) throw timeoutFailure();
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBytes(response, limit, controller) {
  const length = Number(response.headers && response.headers.get
    ? response.headers.get('content-length')
    : null);
  if (Number.isFinite(length) && length > limit) {
    controller.abort();
    throw responseTooLargeFailure();
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value);
        total += chunk.byteLength;
        if (total > limit) {
          controller.abort();
          throw responseTooLargeFailure();
        }
        chunks.push(chunk.slice());
      }
    } finally {
      try { reader.releaseLock(); } catch { /* no-op */ }
    }
    return concatenateBytes(chunks, total);
  }
  if (!response || typeof response.arrayBuffer !== 'function') throw upstreamFailure();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw responseTooLargeFailure();
  return bytes;
}

function normalizeRuntimeResponse(raw, limit) {
  const response = snapshotKnownRecord(raw, new Set(['status', 'ok', 'headers', 'bodyBase64', 'bodyBytes']));
  const status = normalizeStatus(response.status);
  const headers = normalizeRuntimeHeaders(response.headers);
  if (typeof response.bodyBase64 !== 'string' || !isCanonicalBase64(response.bodyBase64)) {
    throw upstreamFailure();
  }
  const bytes = base64ToBytes(response.bodyBase64);
  if (bytes.byteLength > limit) throw responseTooLargeFailure();
  if (response.bodyBytes !== undefined && response.bodyBytes !== bytes.byteLength) throw upstreamFailure();
  return { status, headers, bytes };
}

function extractMessageId(provider, response) {
  if (provider === 'sendgrid') return controlledMessageId(response.headers['x-message-id']);
  if (response.bytes.byteLength === 0) return null;
  let parsed;
  try { parsed = JSON.parse(decodeUtf8Fatal(response.bytes)); } catch { throw upstreamFailure(); }
  const body = snapshotOpenRecord(parsed);
  return controlledMessageId(body.id);
}

function controlledMessageId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 1024 || /[\r\n\0]/.test(value)) {
    throw upstreamFailure();
  }
  return value;
}

function buildSuccess(config, status, messageId, startedAt) {
  const receipt = {
    provider: config.provider,
    messageId,
    status,
    recipientCount: config.recipientCount,
    hasText: Boolean(config.content && config.content.text),
    hasHtml: Boolean(config.content && config.content.html),
    attachmentCount: config.attachments.length,
    templateMode: config.templateMode
  };
  return {
    success: true,
    data: {
      items: [{ index: 0, ...(messageId ? { id: messageId } : {}), data: receipt }],
      summary: { total: 1, success_count: 1, failure_count: 0 }
    },
    error: null,
    metadata: {
      contractVersion: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: config.provider,
      executionId: config.executionId,
      status,
      attempts: 1,
      executedAt: new Date().toISOString(),
      executionMs: Date.now() - startedAt
    },
    citations: []
  };
}

function normalizeBaseUrl(value, allowInsecureHttp) {
  let url;
  try { url = new URL(value); } catch { throw validationFailure(); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw validationFailure();
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw validationFailure();
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol === 'http:' && (!allowInsecureHttp || !isPrivateOrLocalHost(hostname))) {
    throw policyFailure();
  }
  return `${url.protocol}//${url.host}`;
}

function normalizeMailgunDomain(value) {
  const domain = requiredString(value, 253).toLowerCase();
  let parsed;
  try { parsed = new URL(`https://${domain}/`); } catch { throw validationFailure(); }
  if (parsed.hostname !== domain || parsed.port || parsed.pathname !== '/' ||
      !domain.split('.').every(label => label && label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw validationFailure();
  }
  return domain;
}

function rejectUnusedDomain(value) {
  if (value !== undefined) throw validationFailure();
  return null;
}

function normalizeContentString(value) {
  if (typeof value !== 'string' || !value.trim() || encodeUtf8(value).byteLength > MAX_CONTENT_BYTES || /\0/.test(value)) {
    throw validationFailure();
  }
  return value;
}

function normalizeHeaderText(value, maxLength, allowBlank) {
  if (typeof value !== 'string' || value.length > maxLength || /[\r\n\0]/.test(value)) throw validationFailure();
  const text = value.trim();
  if (!allowBlank && !text) throw validationFailure();
  return text || null;
}

function normalizeContentType(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n\0]/.test(value) ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+"'()-]+)*$/.test(value.trim())) {
    throw validationFailure();
  }
  return value.trim();
}

function formatMailbox(address) {
  return address.name
    ? `"${escapeQuoted(address.name)}" <${address.email}>`
    : address.email;
}

function normalizeResponseHeaders(headers) {
  if (!headers || typeof headers.forEach !== 'function') throw upstreamFailure();
  const result = Object.create(null);
  try {
    headers.forEach((value, key) => {
      if (typeof key !== 'string' || typeof value !== 'string') throw upstreamFailure();
      result[key.toLowerCase()] = value;
    });
  } catch (error) {
    if (error instanceof EmailFailure) throw error;
    throw upstreamFailure();
  }
  return result;
}

function normalizeRuntimeHeaders(value) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string' || /[\r\n\0]/.test(item)) throw upstreamFailure();
    result[key.toLowerCase()] = item;
  }
  return result;
}

function normalizeStatus(value) {
  if (!Number.isInteger(value) || value < 100 || value > 599) throw upstreamFailure();
  return value;
}

function readContext(value) {
  if (value === undefined || value === null) return { secrets: Object.create(null), executionId: null };
  const record = snapshotOpenRecord(value);
  return {
    secrets: record.secrets === undefined ? Object.create(null) : snapshotSecrets(record.secrets),
    executionId: record.executionId === undefined ? null : requiredString(record.executionId, 256)
  };
}

function readSafeExecutionId(value) {
  try { return readContext(value).executionId; } catch { return null; }
}

function readSafeProvider(value) {
  try {
    const record = snapshotKnownRecord(value, INPUT_FIELDS);
    return record.provider === 'sendgrid' || record.provider === 'mailgun' ? record.provider : null;
  } catch {
    return null;
  }
}

function snapshotSecrets(value) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof item !== 'string' ||
        !item || item.length > 16_384) {
      throw validationFailure();
    }
    result[key] = item;
  }
  return result;
}

function resolveSecret(name, optionSecrets, contextSecrets) {
  const value = hasOwn(optionSecrets, name)
    ? optionSecrets[name]
    : hasOwn(contextSecrets, name) ? contextSecrets[name] : null;
  if (typeof value !== 'string' || !value) throw secretUnavailableFailure();
  return value;
}

function validateCredential(value) {
  if (/[\r\n\0]/.test(value)) throw validationFailure();
}

function requiredSecretName(value) {
  const name = requiredString(value, 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw validationFailure();
  return name;
}

function snapshotKnownRecord(value, allowedFields) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!allowedFields.has(key) || !hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotOpenRecord(value) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function inspectRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validationFailure();
  try {
    const prototype = Object.getPrototypeOf(value);
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) throw validationFailure();
    return { descriptors };
  } catch (error) {
    if (error instanceof EmailFailure) throw error;
    throw validationFailure();
  }
}

function snapshotArray(value) {
  if (!Array.isArray(value)) throw validationFailure();
  let prototype;
  let symbols;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw validationFailure();
  }
  if (prototype !== Array.prototype || symbols.length > 0) throw validationFailure();
  const length = descriptors.length && descriptors.length.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) throw validationFailure();
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !hasOwn(descriptor, 'value')) throw validationFailure();
    result.push(descriptor.value);
  }
  if (Object.keys(descriptors).some(key => key !== 'length' && !/^\d+$/.test(key))) {
    throw validationFailure();
  }
  return result;
}

function snapshotJsonRecord(value) {
  const result = snapshotJson(value);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw validationFailure();
  return result;
}

function snapshotJson(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationFailure();
    return value;
  }
  if (typeof value !== 'object' || depth > 50 || seen.has(value)) throw validationFailure();
  seen.add(value);
  try {
    if (Array.isArray(value)) return snapshotArray(value).map(item => snapshotJson(item, seen, depth + 1));
    const record = snapshotOpenRecord(value);
    const result = Object.create(null);
    for (const [key, item] of Object.entries(record)) result[key] = snapshotJson(item, seen, depth + 1);
    return result;
  } finally {
    seen.delete(value);
  }
}

function requiredString(value, maxLength) {
  if (typeof value !== 'string') throw validationFailure();
  const text = value.trim();
  if (!text || text.length > maxLength || /\0/.test(text)) throw validationFailure();
  return text;
}

function optionalString(value, fallback, maxLength) {
  return value === undefined ? fallback : requiredString(value, maxLength);
}

function requiredEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw validationFailure();
  return value;
}

function optionalEnum(value, allowed, fallback) {
  return value === undefined ? fallback : requiredEnum(value, allowed);
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validationFailure();
  return value;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw validationFailure();
  return value;
}

function normalizeFailure(error) {
  const failure = error instanceof EmailFailure ? error : upstreamFailure();
  return {
    message: failure.message,
    code: failure.code,
    type: failure.type,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retriable === undefined ? {} : { retriable: failure.retriable })
  };
}

function validationFailure() {
  return new EmailFailure('EMAIL_VALIDATION', 'Invalid email delivery request.', 'ValidationError', {
    retriable: false
  });
}

function secretUnavailableFailure() {
  return new EmailFailure(
    'EMAIL_SECRET_UNAVAILABLE',
    'A required email provider secret is unavailable.',
    'SecretUnavailableError',
    { retriable: false }
  );
}

function policyFailure() {
  return new EmailFailure('EMAIL_POLICY', 'Email provider policy denied the endpoint.', 'PolicyError', {
    retriable: false
  });
}

function timeoutFailure() {
  return new EmailFailure('EMAIL_TIMEOUT', 'Email delivery exceeded the total deadline.', 'TimeoutError', {
    retriable: true
  });
}

function responseTooLargeFailure() {
  return new EmailFailure(
    'EMAIL_RESPONSE_TOO_LARGE',
    'Email provider response exceeded the configured size limit.',
    'ResponseLimitError',
    { retriable: false }
  );
}

function redirectFailure() {
  return new EmailFailure('EMAIL_REDIRECT', 'Email provider redirect was rejected.', 'RedirectError', {
    retriable: false
  });
}

function providerFailure(status) {
  return new EmailFailure('EMAIL_PROVIDER', 'Email provider rejected the delivery.', 'ProviderError', {
    status,
    retriable: status === 408 || status === 425 || status === 429 || status >= 500
  });
}

function upstreamFailure() {
  return new EmailFailure('EMAIL_UPSTREAM', 'Email provider transport failed.', 'UpstreamError', {
    retriable: true
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function asciiFilename(value) {
  const result = value.replace(/[^\x20-\x7e]/g, '_');
  return result || 'attachment';
}

function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomHex(bytes) {
  const data = new Uint8Array(bytes);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(data);
  } else {
    for (let index = 0; index < data.length; index += 1) data[index] = Math.floor(Math.random() * 256);
  }
  return Array.from(data, item => item.toString(16).padStart(2, '0')).join('');
}

function containsBytes(haystack, needle) {
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) return false;
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function concatenateBytes(chunks, total) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function encodeUtf8(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else codePoint = 0xfffd;
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8Fatal(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    let codePoint;
    let length;
    let minimum;
    if (first <= 0x7f) [codePoint, length, minimum] = [first, 1, 0];
    else if (first >= 0xc2 && first <= 0xdf) [codePoint, length, minimum] = [first & 0x1f, 2, 0x80];
    else if (first >= 0xe0 && first <= 0xef) [codePoint, length, minimum] = [first & 0x0f, 3, 0x800];
    else if (first >= 0xf0 && first <= 0xf4) [codePoint, length, minimum] = [first & 0x07, 4, 0x10000];
    else throw upstreamFailure();
    if (index + length > bytes.length) throw upstreamFailure();
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) throw upstreamFailure();
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (codePoint < minimum || codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) throw upstreamFailure();
    if (codePoint <= 0xffff) result += String.fromCharCode(codePoint);
    else {
      const adjusted = codePoint - 0x10000;
      result += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
    index += length;
  }
  return result;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  try { return bytesToBase64(base64ToBytes(value)) === value; } catch { return false; }
}

function base64ToBytes(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  if (typeof atob !== 'function') throw validationFailure();
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  if (typeof btoa !== 'function') throw upstreamFailure();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function encodeUtf8Base64(value) {
  return bytesToBase64(encodeUtf8(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasRuntimeHttpOperation() {
  return typeof globalThis.Deno !== 'undefined' && globalThis.Deno && globalThis.Deno.core &&
    globalThis.Deno.core.ops && typeof globalThis.Deno.core.ops.op_http_request === 'function';
}

function ensureTransport() {
  if (!hasRuntimeHttpOperation() && typeof fetch !== 'function') throw upstreamFailure();
  if (typeof URL !== 'function' || typeof AbortController !== 'function') throw upstreamFailure();
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':') && (host === '::' || host === '::1' || host.startsWith('fc') ||
      host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') ||
      host.startsWith('fea') || host.startsWith('feb'))) return true;
  if (host.startsWith('::ffff:')) return isPrivateOrLocalHost(host.slice(7));
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}
