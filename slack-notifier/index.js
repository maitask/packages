/**
 * @maitask/slack-notifier
 * Send a message through a Slack Incoming Webhook.
 *
 * @version 0.1.0
 * @license MIT
 */

const PACKAGE_NAME = '@maitask/slack-notifier';
const PACKAGE_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_PROVIDER_NORMALIZATION_PASSES = 4;
const CONTROLLED_SLACK_ERRORS = new WeakSet();
const INPUT_FIELDS = new Set(['text', 'blocks', 'attachments']);
const OPTION_FIELDS = new Set([
  'webhookUrl',
  'threadTs',
  'channel',
  'username',
  'iconEmoji',
  'iconUrl',
  'linkNames',
  'mrkdwn',
  'timeoutMs'
]);

async function execute(input, options = {}, context = {}) {
  let config;
  let metadataWebhook = null;

  try {
    let safeOptions;
    try {
      safeOptions = snapshotPublicObject(options, 'options', OPTION_FIELDS);
    } catch (error) {
      if (isSlackError(error) && error.snapshot) {
        metadataWebhook = extractMetadataWebhook(error.snapshot, null);
      }
      throw error;
    }
    metadataWebhook = extractMetadataWebhook(safeOptions, null);

    const safeContext = snapshotPublicObject(context, 'context');
    let safeSecrets = Object.create(null);
    if (Object.hasOwn(safeContext, 'secrets') && safeContext.secrets !== undefined) {
      try {
        safeSecrets = snapshotPublicObject(safeContext.secrets, 'context.secrets');
      } catch (error) {
        if (
          isSlackError(error) &&
          error.snapshot &&
          !Object.hasOwn(safeOptions, 'webhookUrl')
        ) {
          metadataWebhook = extractMetadataWebhook(safeOptions, error.snapshot);
        }
        throw error;
      }
    }
    metadataWebhook = extractMetadataWebhook(safeOptions, safeSecrets);

    config = buildConfig(input, safeOptions, safeSecrets);
    const payload = buildSlackPayload(config);
    const response = await sendSlackMessage(config, payload);
    const data = {
      webhook: maskWebhookUrl(config.webhookUrl),
      username: config.username,
      hasBlocks: config.blocks !== undefined,
      hasAttachments: config.attachments !== undefined
    };

    if (config.iconEmoji !== undefined) data.icon = config.iconEmoji;
    if (config.channel !== undefined) data.channel = config.channel;
    if (config.threadTs !== undefined) data.threadTs = config.threadTs;

    return {
      success: true,
      data,
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        provider: 'slack',
        webhook: metadataWebhook,
        responseStatus: response.status,
        responseTimeMs: response.responseTimeMs,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    const normalizedError = isSlackError(error)
      ? error
      : slackError('Slack notification failed');
    const metadata = {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'slack',
      webhook: metadataWebhook,
      timestamp: new Date().toISOString()
    };

    return {
      success: false,
      error: serializeSlackError(normalizedError),
      metadata
    };
  }
}

function buildConfig(input, options, secrets) {
  const task = normalizeInput(input);
  const webhookValue = Object.hasOwn(options, 'webhookUrl')
    ? options.webhookUrl
    : secrets.SLACK_WEBHOOK_URL;
  const webhookUrl = normalizeWebhookUrl(webhookValue);

  const threadTs = optionalNonEmptyString(options, 'threadTs');
  const channel = optionalNonEmptyString(options, 'channel');
  const username = Object.hasOwn(options, 'username')
    ? requiredNonEmptyString(options.username, 'username')
    : 'Maitask Bot';
  const explicitIconEmoji = Object.hasOwn(options, 'iconEmoji');
  const explicitIconUrl = Object.hasOwn(options, 'iconUrl');

  if (explicitIconEmoji) requiredNonEmptyString(options.iconEmoji, 'iconEmoji');
  if (explicitIconUrl) requiredNonEmptyString(options.iconUrl, 'iconUrl');
  if (explicitIconEmoji && explicitIconUrl) {
    throw slackError('iconEmoji and iconUrl cannot both be provided');
  }

  const iconEmoji = explicitIconEmoji
    ? options.iconEmoji
    : explicitIconUrl
      ? undefined
      : ':robot_face:';
  const iconUrl = explicitIconUrl ? options.iconUrl : undefined;
  const linkNames = optionalBoolean(options, 'linkNames', true);
  const mrkdwn = optionalBoolean(options, 'mrkdwn', true);
  const timeoutMs = normalizeTimeout(options);

  return {
    webhookUrl,
    text: task.text,
    blocks: task.blocks,
    attachments: task.attachments,
    threadTs,
    channel,
    username,
    iconEmoji,
    iconUrl,
    linkNames,
    mrkdwn,
    timeoutMs
  };
}

function normalizeInput(input) {
  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      throw slackError('Slack task content requires non-blank text, blocks, or attachments');
    }
    return { text: input };
  }

  const safeInput = snapshotPublicObject(input, 'input', INPUT_FIELDS);
  const task = {};

  if (Object.hasOwn(safeInput, 'text')) {
    if (typeof safeInput.text !== 'string') {
      throw slackError('text must be a string');
    }
    task.text = safeInput.text;
  }
  if (Object.hasOwn(safeInput, 'blocks')) {
    task.blocks = cloneBlockArray(safeInput.blocks);
  }
  if (Object.hasOwn(safeInput, 'attachments')) {
    task.attachments = cloneRichContentArray(safeInput.attachments, 'attachments');
  }

  const hasRichContent = task.blocks !== undefined || task.attachments !== undefined;
  if ((!hasRichContent && (task.text === undefined || task.text.trim().length === 0))) {
    throw slackError('Slack task content requires non-blank text, blocks, or attachments');
  }

  return task;
}

function cloneRichContentArray(value, field) {
  const clone = cloneJsonData(value, field, new WeakSet());
  if (!Array.isArray(clone) || clone.length === 0) {
    throw slackError(`${field} must be a non-empty array of plain objects`);
  }
  for (const [index, item] of clone.entries()) {
    if (!isPlainObject(item)) {
      throw slackError(`${field}[${index}] must be a plain object`);
    }
  }
  return clone;
}

function cloneBlockArray(value) {
  const clone = cloneRichContentArray(value, 'blocks');

  for (const [index, block] of clone.entries()) {
    const typeDescriptor = Object.getOwnPropertyDescriptor(block, 'type');
    const type = typeDescriptor && Object.hasOwn(typeDescriptor, 'value')
      ? typeDescriptor.value
      : undefined;
    if (typeof type !== 'string' || type.trim().length === 0) {
      throw slackError(`blocks[${index}].type must be an own non-blank string data property`);
    }
  }
  return clone;
}

function assertPlainObject(value, field) {
  if (!isPlainObject(value)) {
    throw slackError(`${field} must be a plain object`);
  }
}

function snapshotPublicObject(value, container, allowedFields = null) {
  assertPlainObject(value, container);
  const snapshot = Object.create(null);
  let validationError;

  for (const field of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (typeof field !== 'string') {
      validationError ||= slackError(`${container} symbol fields are not supported`);
      continue;
    }
    if (allowedFields && !allowedFields.has(field)) {
      validationError ||= slackError(`${container}.${field} is not supported`);
      continue;
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      validationError ||= slackError(`${container}.${field} must be an own data property`);
      continue;
    }
    defineJsonProperty(snapshot, field, descriptor.value);
  }

  if (validationError) {
    Object.defineProperty(validationError, 'snapshot', { value: snapshot });
    throw validationError;
  }
  return snapshot;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonData(value, path, activeObjects) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw slackError(`${path} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw slackError(`${path} must contain only JSON data values`);
  }
  if (activeObjects.has(value)) {
    throw slackError(`${path} must not contain cycles`);
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw slackError(`${path} arrays must use the standard Array prototype`);
    }
    activeObjects.add(value);
    try {
      return cloneJsonArray(value, path, activeObjects);
    } finally {
      activeObjects.delete(value);
    }
  }

  if (!isPlainObject(value)) {
    throw slackError(`${path} objects must be plain objects`);
  }
  activeObjects.add(value);
  try {
    return cloneJsonObject(value, path, activeObjects);
  } finally {
    activeObjects.delete(value);
  }
}

function cloneJsonArray(value, path, activeObjects) {
  const descriptors = new Map();
  let length;

  for (const field of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (typeof field !== 'string') {
      throw slackError(`${path} arrays must not contain symbol fields`);
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw slackError(`${path} arrays must contain only own data properties`);
    }
    if (field === 'length') {
      length = descriptor.value;
      continue;
    }
    descriptors.set(field, descriptor);
  }

  if (!Number.isSafeInteger(length) || length < 0) {
    throw slackError(`${path} arrays must have a valid length`);
  }
  for (const field of descriptors.keys()) {
    if (!isArrayIndex(field, length)) {
      throw slackError(`${path} arrays must not contain extra fields`);
    }
  }

  const clone = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors.get(String(index));
    if (!descriptor) {
      throw slackError(`${path} arrays must not contain holes`);
    }
    clone[index] = cloneJsonData(descriptor.value, `${path}[${index}]`, activeObjects);
  }
  return clone;
}

function cloneJsonObject(value, path, activeObjects) {
  const clone = Object.create(null);

  for (const field of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (typeof field !== 'string') {
      throw slackError(`${path} objects must not contain symbol fields`);
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      if (field === 'type' && path.startsWith('blocks[')) {
        throw slackError(`${path}.type must be an own non-blank string data property`);
      }
      throw slackError(`${path} objects must contain only own data properties`);
    }
    if (field === 'toJSON' && typeof descriptor.value === 'function') {
      throw slackError(`${path} objects must not define toJSON functions`);
    }
    defineJsonProperty(
      clone,
      field,
      cloneJsonData(descriptor.value, path, activeObjects)
    );
  }
  return clone;
}

function isArrayIndex(field, length) {
  const index = Number(field);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === field;
}

function defineJsonProperty(object, field, value) {
  Object.defineProperty(object, field, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function optionalNonEmptyString(object, field) {
  if (!Object.hasOwn(object, field)) return undefined;
  return requiredNonEmptyString(object[field], field);
}

function requiredNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw slackError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(object, field, defaultValue) {
  if (!Object.hasOwn(object, field)) return defaultValue;
  if (typeof object[field] !== 'boolean') {
    throw slackError(`${field} must be a boolean`);
  }
  return object[field];
}

function normalizeTimeout(options) {
  if (!Object.hasOwn(options, 'timeoutMs')) return DEFAULT_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw slackError('timeoutMs must be a finite positive number');
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

function normalizeWebhookUrl(value) {
  if (value === undefined) {
    throw slackError('webhookUrl is required');
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw slackError('webhookUrl must be a non-empty absolute HTTP or HTTPS URL');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw slackError('webhookUrl must be a non-empty absolute HTTP or HTTPS URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw slackError('webhookUrl must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw slackError('webhookUrl must not include credentials');
  }
  if (parsed.search || parsed.hash) {
    throw slackError('webhookUrl must not include a query or fragment');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (!normalizedPath || normalizedPath === '/') {
    throw slackError('webhookUrl must include a non-root path');
  }

  return `${parsed.origin}${normalizedPath}`;
}

function extractMetadataWebhook(options, secrets) {
  try {
    let value;
    if (options && Object.hasOwn(options, 'webhookUrl')) {
      value = options.webhookUrl;
    } else if (secrets && Object.hasOwn(secrets, 'SLACK_WEBHOOK_URL')) {
      value = secrets.SLACK_WEBHOOK_URL;
    }

    if (value === undefined) return null;
    return maskWebhookUrl(normalizeWebhookUrl(value));
  } catch {
    return null;
  }
}

function buildSlackPayload(config) {
  const payload = {};

  if (config.text !== undefined) payload.text = config.text;
  if (config.blocks !== undefined) payload.blocks = config.blocks;
  if (config.attachments !== undefined) payload.attachments = config.attachments;
  if (config.threadTs !== undefined) payload.thread_ts = config.threadTs;
  if (config.channel !== undefined) payload.channel = config.channel;
  payload.username = config.username;
  if (config.iconEmoji !== undefined) payload.icon_emoji = config.iconEmoji;
  if (config.iconUrl !== undefined) payload.icon_url = config.iconUrl;
  payload.link_names = config.linkNames;
  payload.mrkdwn = config.mrkdwn;

  return payload;
}

async function sendSlackMessage(config, payload) {
  ensureFetch();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal
    });
    const body = await response.text();
    const responseTimeMs = Date.now() - startedAt;

    if (!response.ok || body.trim().toLowerCase() !== 'ok') {
      throw providerError(response, body, config.webhookUrl);
    }

    return { status: response.status, responseTimeMs };
  } catch (error) {
    if (isSlackError(error)) throw error;
    if (timedOut || controller.signal.aborted) {
      throw slackError('Slack request timed out', {
        retriable: true,
        details: { timeoutMs: config.timeoutMs }
      });
    }
    throw slackError('Slack request failed', { retriable: true });
  } finally {
    clearTimeout(timeoutId);
  }
}

function providerError(response, body, webhookUrl) {
  const status = response.status;
  const safeBody = sanitizeProviderText(body, webhookUrl);
  const retriable =
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599);
  const message = safeBody
    ? `Slack webhook rejected with status ${status}: ${safeBody}`
    : `Slack webhook rejected with status ${status}`;
  const fields = { status, retriable };

  if (status === 429) {
    const retryAfter = response.headers?.get?.('retry-after');
    if (typeof retryAfter === 'string' && /^[1-9]\d*$/.test(retryAfter)) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isSafeInteger(retryAfterSeconds)) {
        fields.details = { retryAfterSeconds };
      }
    }
  }

  return slackError(message, fields);
}

function sanitizeProviderText(value, webhookUrl) {
  if (typeof value !== 'string') return '';
  let sanitized = normalizeProviderEncoding(value);
  const secrets = webhookSecrets(webhookUrl).sort((a, b) => b.length - a.length);

  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.replace(new RegExp(escapeRegExp(secret), 'gi'), '[redacted]');
  }

  sanitized = sanitized.replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
    '[redacted-url]'
  );
  return sanitized.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function normalizeProviderEncoding(value) {
  let normalized = value;

  for (let pass = 0; pass < MAX_PROVIDER_NORMALIZATION_PASSES; pass += 1) {
    const next = decodePercentRuns(normalized.replace(/\\\//g, '/'));
    if (next === normalized) break;
    normalized = next;
  }

  return normalized;
}

function decodePercentRuns(value) {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, run => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-9a-f]{2})/gi, (encodedByte, hex) => {
        const byte = Number.parseInt(hex, 16);
        return byte <= 0x7f ? String.fromCharCode(byte) : encodedByte;
      });
    }
  });
}

function webhookSecrets(webhookUrl) {
  try {
    const parsed = new URL(webhookUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const sensitiveParts = parts[0] === 'services' ? parts.slice(1) : parts;
    const secrets = new Set([
      normalizeProviderEncoding(webhookUrl),
      normalizeProviderEncoding(parsed.pathname)
    ]);

    for (const part of sensitiveParts) {
      secrets.add(normalizeProviderEncoding(part));
    }
    return [...secrets];
  } catch {
    return [];
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskWebhookUrl(webhookUrl) {
  try {
    const parsed = new URL(webhookUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const isStandardSlackPath =
      parts.length === 4 &&
      parts[0] === 'services' &&
      /^T.+/.test(parts[1]) &&
      /^B.+/.test(parts[2]) &&
      parts[3].length > 0;

    return isStandardSlackPath
      ? `${parsed.origin}/services/T***/B***/***`
      : `${parsed.origin}/services/***`;
  } catch {
    return null;
  }
}

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw slackError('Global fetch API is unavailable; Node.js 18 or newer is required');
  }
}

function slackError(message, fields = {}) {
  const error = new Error(message);
  CONTROLLED_SLACK_ERRORS.add(error);
  error.code = 'SLACK_ERROR';
  error.type = 'SlackNotificationError';
  if (fields.status !== undefined) error.status = fields.status;
  if (fields.retriable !== undefined) error.retriable = fields.retriable;
  if (fields.details !== undefined) error.details = fields.details;
  return error;
}

function isSlackError(error) {
  return typeof error === 'object' && error !== null && CONTROLLED_SLACK_ERRORS.has(error);
}

function serializeSlackError(error) {
  const result = {
    message: error.message,
    code: 'SLACK_ERROR',
    type: 'SlackNotificationError'
  };
  if (error.status !== undefined) result.status = error.status;
  if (error.retriable !== undefined) result.retriable = error.retriable;
  if (error.details !== undefined) result.details = error.details;
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;
