/**
 * Telegram Bot API Integration
 * Send messages via Telegram Bot API to users and groups
 * Documentation: https://core.telegram.org/bots/api
 */

const PACKAGE_NAME = '@maitask/telegram-bot';
const PACKAGE_VERSION = '0.1.1';
const DEFAULT_BASE_URL = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_PROVIDER_NORMALIZATION_PASSES = 4;
const MAX_PROVIDER_MESSAGE_LENGTH = 1000;
const RETRIABLE_STATUSES = new Set([408, 425, 429]);
const INPUT_FIELDS = new Set(['text', 'fileUrl', 'caption']);
const OPTION_FIELDS = new Set([
    'baseUrl',
    'botToken',
    'chatId',
    'messageType',
    'parseMode',
    'replyToMessageId',
    'disableNotification',
    'disableWebPagePreview',
    'replyMarkup',
    'timeoutMs'
]);
const PARSE_MODES = new Set(['Markdown', 'MarkdownV2', 'HTML']);
const CONTROLLED_TELEGRAM_ERRORS = new WeakSet();

class TelegramBotError extends Error {
    constructor(message, { status, retriable, details } = {}) {
        super(message);
        this.name = 'TelegramBotError';
        this.status = status;
        this.retriable = retriable;
        this.details = details;
        CONTROLLED_TELEGRAM_ERRORS.add(this);
    }
}

async function execute(input, options = {}, context = {}) {
    let config;

    try {
        config = buildConfig(input, options, context);
        ensureFetch();

        const method = methodForMessageType(config.messageType);
        const payload = buildPayload(config);
        const message = await telegramRequest(
            buildRequestUrl(config.baseUrl, config.botToken, method),
            payload,
            config.timeoutMs
        );

        return {
            success: true,
            data: buildSuccessData(message),
            metadata: buildMetadata({ method })
        };
    } catch (error) {
        return buildErrorResult(error, config?.botToken);
    }
}

function buildConfig(input, options, context) {
    options = snapshotStrictRecord(options, OPTION_FIELDS, 'options');
    context = snapshotRuntimeContext(context);

    const content = normalizeInput(input);
    const messageType = options.messageType === undefined ? 'text' : options.messageType;
    const botToken =
        options.botToken === undefined
            ? context.secrets?.TELEGRAM_BOT_TOKEN
            : options.botToken;
    const chatId = options.chatId;

    if (typeof messageType !== 'string' || !['text', 'photo', 'document'].includes(messageType)) {
        throw new TelegramBotError('messageType must be text, photo, or document');
    }
    if (typeof botToken !== 'string' || botToken.trim().length === 0) {
        throw new TelegramBotError('botToken is required');
    }
    if (!/^[A-Za-z0-9:_-]+$/u.test(botToken)) {
        throw new TelegramBotError('botToken contains unsupported characters');
    }
    if (!isValidChatId(chatId)) {
        throw new TelegramBotError('chatId is required (user ID, group ID, or channel username)');
    }
    if (messageType === 'text' && !hasNonBlankString(content.text)) {
        throw new TelegramBotError('Text content is required for text messages');
    }
    if (messageType !== 'text' && !hasNonBlankString(content.fileUrl)) {
        throw new TelegramBotError(`fileUrl is required for ${messageType} messages`);
    }
    const normalizedFileUrl = messageType === 'text'
        ? content.fileUrl
        : normalizeFileUrl(content.fileUrl);

    validateOperationalOptions(options);
    const replyMarkup =
        options.replyMarkup === undefined
            ? undefined
            : cloneReplyMarkup(options.replyMarkup);

    return {
        baseUrl: normalizeBaseUrl(selectBaseUrl(options, context)),
        botToken,
        chatId,
        messageType,
        text: content.text,
        fileUrl: normalizedFileUrl,
        caption: content.caption ?? content.text,
        parseMode: options.parseMode === undefined ? 'Markdown' : options.parseMode,
        replyToMessageId: options.replyToMessageId,
        disableNotification: options.disableNotification === true,
        disableWebPagePreview: options.disableWebPagePreview,
        replyMarkup,
        timeoutMs: normalizeTimeout(options.timeoutMs)
    };
}

function selectBaseUrl(options, context) {
    if (options.baseUrl !== undefined) {
        return options.baseUrl;
    }
    if (context.env?.TELEGRAM_API_BASE_URL !== undefined) {
        return context.env.TELEGRAM_API_BASE_URL;
    }
    return DEFAULT_BASE_URL;
}

function normalizeInput(input) {
    if (typeof input === 'string') {
        return { text: input };
    }
    input = snapshotStrictRecord(input, INPUT_FIELDS, 'input');

    for (const field of ['text', 'fileUrl', 'caption']) {
        if (input[field] !== undefined && typeof input[field] !== 'string') {
            throw new TelegramBotError(`Input ${field} must be a string`);
        }
    }

    return {
        text: input.text,
        fileUrl: input.fileUrl,
        caption: input.caption
    };
}

function normalizeBaseUrl(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TelegramBotError(
            'baseUrl (base URL) must be an absolute HTTP or HTTPS URL'
        );
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new TelegramBotError(
            'baseUrl (base URL) must be an absolute HTTP or HTTPS URL'
        );
    }

    if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        !parsed.host ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
    ) {
        throw new TelegramBotError(
            'baseUrl (base URL) must be an absolute HTTP or HTTPS URL'
        );
    }

    if (isBlockedTelegramBaseHost(parsed.hostname)) {
        throw new TelegramBotError(
            'baseUrl (base URL) host is not permitted'
        );
    }

    return parsed.toString().replace(/\/+$/, '');
}

function normalizeFileUrl(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TelegramBotError('fileUrl must be a valid HTTP or HTTPS URL');
    }
    let parsed;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new TelegramBotError('fileUrl must be a valid HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password) {
        throw new TelegramBotError('fileUrl must be a valid HTTP or HTTPS URL without embedded credentials');
    }
    if (isBlockedHost(parsed.hostname)) {
        throw new TelegramBotError('fileUrl host is not permitted');
    }
    return parsed.toString();
}

function isBlockedTelegramBaseHost(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
        return false;
    }
    return isBlockedHost(normalized);
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

function normalizeTimeout(value) {
    if (value === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TelegramBotError('timeoutMs must be a positive number');
    }

    return Math.min(value, MAX_TIMEOUT_MS);
}

function hasNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidChatId(value) {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function validateOperationalOptions(options) {
    if (options.parseMode !== undefined && !PARSE_MODES.has(options.parseMode)) {
        throw new TelegramBotError(
            'parseMode must be Markdown, MarkdownV2, or HTML'
        );
    }
    validateOptionalBoolean(options.disableNotification, 'disableNotification');
    validateOptionalBoolean(options.disableWebPagePreview, 'disableWebPagePreview');

    if (
        options.replyToMessageId !== undefined &&
        (!Number.isSafeInteger(options.replyToMessageId) || options.replyToMessageId <= 0)
    ) {
        throw new TelegramBotError('replyToMessageId must be a positive integer');
    }
}

function validateOptionalBoolean(value, field) {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new TelegramBotError(`${field} must be a boolean`);
    }
}

function snapshotStrictRecord(value, allowedFields, field) {
    assertRecordShape(value, field);
    const snapshot = Object.create(null);

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
            throw new TelegramBotError(`${field} must not contain symbol fields`);
        }
        if (!allowedFields.has(key)) {
            throw new TelegramBotError(`${field} contains unsupported field ${key}`);
        }
        snapshot[key] = readOwnDataProperty(value, key, field);
    }

    return snapshot;
}

function snapshotRuntimeContext(context) {
    assertRecordShape(context, 'context');
    rejectSymbolFields(context, 'context');

    const secrets = readOwnDataProperty(context, 'secrets', 'context');
    const env = readOwnDataProperty(context, 'env', 'context');

    return {
        secrets:
            secrets === undefined
                ? undefined
                : snapshotSelectedRecord(
                    secrets,
                    ['TELEGRAM_BOT_TOKEN'],
                    'context.secrets'
                ),
        env:
            env === undefined
                ? undefined
                : snapshotSelectedRecord(
                    env,
                    ['TELEGRAM_API_BASE_URL'],
                    'context.env'
                )
    };
}

function snapshotSelectedRecord(value, selectedFields, field) {
    assertRecordShape(value, field);
    const snapshot = Object.create(null);

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
            throw new TelegramBotError(`${field} must not contain symbol fields`);
        }
        const propertyValue = readOwnDataProperty(value, key, field);
        if (selectedFields.includes(key)) {
            snapshot[key] = propertyValue;
        }
    }

    return snapshot;
}

function assertRecordShape(value, field) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TelegramBotError(`${field} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TelegramBotError(`${field} must be a plain object`);
    }
}

function rejectSymbolFields(value, field) {
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) {
        throw new TelegramBotError(`${field} must not contain symbol fields`);
    }
}

function readOwnDataProperty(value, key, field) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
        return undefined;
    }
    if (!Object.hasOwn(descriptor, 'value')) {
        throw new TelegramBotError(`${field}.${key} must be an own data property`);
    }
    return descriptor.value;
}

function cloneReplyMarkup(value) {
    try {
        if (!isPlainObject(value)) {
            throw invalidReplyMarkupError();
        }
        return copyJsonData(value, new Set());
    } catch (error) {
        if (isControlledTelegramError(error)) {
            throw error;
        }
        throw invalidReplyMarkupError();
    }
}

function copyJsonData(value, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw invalidReplyMarkupError();
        }
        return value;
    }
    if (typeof value !== 'object') {
        throw invalidReplyMarkupError();
    }
    if (ancestors.has(value)) {
        throw invalidReplyMarkupError();
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return copyJsonArray(value, ancestors);
        }
        if (!isPlainObject(value)) {
            throw invalidReplyMarkupError();
        }
        return copyJsonObject(value, ancestors);
    } finally {
        ancestors.delete(value);
    }
}

function copyJsonArray(value, ancestors) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw invalidReplyMarkupError();
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0) {
        throw invalidReplyMarkupError();
    }

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
            throw invalidReplyMarkupError();
        }
        if (key !== 'length' && !isArrayIndexKey(key, length)) {
            throw invalidReplyMarkupError();
        }
    }

    const copy = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
            throw invalidReplyMarkupError();
        }
        copy.push(copyJsonData(descriptor.value, ancestors));
    }
    return copy;
}

function copyJsonObject(value, ancestors) {
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
            throw invalidReplyMarkupError();
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
            throw invalidReplyMarkupError();
        }
        copy[key] = copyJsonData(descriptor.value, ancestors);
    }
    return copy;
}

function isArrayIndexKey(key, length) {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function invalidReplyMarkupError() {
    return new TelegramBotError('replyMarkup must contain only controlled JSON data');
}

function methodForMessageType(messageType) {
    if (messageType === 'photo') {
        return 'sendPhoto';
    }
    if (messageType === 'document') {
        return 'sendDocument';
    }
    return 'sendMessage';
}

function buildRequestUrl(baseUrl, botToken, method) {
    const requestUrl = new URL(`${baseUrl}/`);
    const basePath = requestUrl.pathname.replace(/\/+$/, '');
    requestUrl.pathname = `${basePath}/bot${encodeURIComponent(botToken)}/${method}`;
    return requestUrl;
}

function buildPayload(config) {
    const payload = {
        chat_id: config.chatId,
        parse_mode: config.parseMode,
        reply_to_message_id: config.replyToMessageId,
        disable_notification: config.disableNotification,
        reply_markup: config.replyMarkup
    };

    if (config.messageType === 'text') {
        payload.text = config.text;
        payload.disable_web_page_preview = config.disableWebPagePreview;
    } else {
        payload[config.messageType] = config.fileUrl;
        payload.caption = config.caption;
    }

    return omitUndefined(payload);
}

function omitUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function buildSuccessData(message) {
    return omitUndefined({
        messageId: message?.message_id,
        chatId: message?.chat?.id,
        text: message?.text,
        caption: message?.caption
    });
}

async function telegramRequest(url, payload, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await postTelegramJson(url, payload, timeoutMs, controller.signal);
        const responseText = await readBoundedTelegramText(response, 1024 * 1024);
        let responseData;

        try {
            responseData = responseText ? JSON.parse(responseText) : {};
        } catch {
            throw new TelegramBotError('Telegram API returned a non-JSON response', {
                status: response.status,
                retriable: isRetriableStatus(response.status)
            });
        }

        if (!isPlainObject(responseData)) {
            throw malformedResponseError(response.status);
        }

        if (!response.ok || responseData.ok === false) {
            const status = validErrorStatus(responseData.error_code) ?? response.status;
            const description =
                typeof responseData.description === 'string'
                    ? responseData.description
                    : 'Telegram API request failed';
            const retryAfterSeconds = responseData.parameters?.retry_after;
            const details =
                Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
                    ? { retryAfterSeconds }
                    : undefined;
            throw new TelegramBotError(
                `Telegram API error: ${status} - ${description}`,
                {
                    status,
                    retriable: isRetriableStatus(status),
                    details
                }
            );
        }

        if (responseData.ok !== true || !isValidMessageResult(responseData.result)) {
            throw malformedResponseError(response.status);
        }

        return responseData.result;
    } catch (error) {
        if (timedOut) {
            throw new TelegramBotError(`Telegram request timed out after ${timeoutMs} ms`, {
                retriable: true,
                details: { timeoutMs }
            });
        }
        if (isControlledTelegramError(error)) {
            throw error;
        }
        throw new TelegramBotError('Telegram request failed', { retriable: true });
    } finally {
        clearTimeout(timeoutId);
    }
}

function isRetriableStatus(status) {
    return RETRIABLE_STATUSES.has(status) || status >= 500;
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validErrorStatus(value) {
    return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function isValidMessageResult(result) {
    return (
        isPlainObject(result) &&
        Number.isSafeInteger(result.message_id) &&
        result.message_id > 0 &&
        isPlainObject(result.chat) &&
        Number.isSafeInteger(result.chat.id) &&
        (result.text === undefined || typeof result.text === 'string') &&
        (result.caption === undefined || typeof result.caption === 'string')
    );
}

function malformedResponseError(status) {
    return new TelegramBotError('Telegram API returned a malformed response', {
        status,
        retriable: isRetriableStatus(status)
    });
}

function buildErrorResult(error, botToken) {
    const telegramError =
        isControlledTelegramError(error)
            ? error
            : new TelegramBotError('Telegram request failed');
    const safeMessage = sanitizeProviderMessage(telegramError.message, botToken);
    const errorData = {
        message: safeMessage,
        code: 'TELEGRAM_ERROR',
        type: 'TelegramBotError',
        status: telegramError.status,
        retriable: telegramError.retriable,
        details: telegramError.details
    };

    return {
        success: false,
        error: omitUndefined(errorData),
        metadata: buildMetadata()
    };
}

function isControlledTelegramError(value) {
    const valueType = typeof value;
    if ((valueType !== 'object' && valueType !== 'function') || value === null) {
        return false;
    }
    return CONTROLLED_TELEGRAM_ERRORS.has(value);
}

function sanitizeProviderMessage(message, botToken) {
    if (typeof message !== 'string') {
        return message;
    }

    let sanitized = normalizeProviderEncoding(message);
    if (botToken) {
        sanitized = sanitized.replace(
            new RegExp(escapeRegExp(botToken), 'giu'),
            '[REDACTED]'
        );
    }

    sanitized = sanitized.replace(
        /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/gu,
        '[REDACTED_URL]'
    );
    return sanitized
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

function normalizeProviderEncoding(value) {
    let normalized = value;

    for (let pass = 0; pass < MAX_PROVIDER_NORMALIZATION_PASSES; pass += 1) {
        const next = decodePercentRuns(normalized.replace(/\\\//gu, '/'));
        if (next === normalized) {
            break;
        }
        normalized = next;
    }

    return normalized;
}

function decodePercentRuns(value) {
    return value.replace(/(?:%[0-9A-F]{2})+/giu, run => {
        try {
            return decodeURIComponent(run);
        } catch {
            return run.replace(/%([0-9A-F]{2})/giu, (encodedByte, hex) => {
                const byte = Number.parseInt(hex, 16);
                return byte <= 0x7f ? String.fromCharCode(byte) : encodedByte;
            });
        }
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildMetadata(extra = {}) {
    return {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        provider: 'telegram',
        ...extra,
        timestamp: new Date().toISOString()
    };
}

function ensureFetch() {
    if (!hasRuntimeHttpOp() && typeof fetch !== 'function') {
        throw new TelegramBotError(
            'Global fetch API is unavailable. Please run @maitask/telegram-bot on Node.js 18 or newer.'
        );
    }
}

function hasRuntimeHttpOp() {
    return typeof globalThis.Deno?.core?.ops?.op_http_request === 'function';
}

function decodeRuntimeBodyUtf8(raw) {
    if (typeof raw?.body === 'string') return raw.body;
    if (typeof raw?.bodyBase64 !== 'string' || !raw.bodyBase64) return '';
    const binary = atob(raw.bodyBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function isRuntimeTimeoutError(error) {
    return typeof error?.message === 'string' && /timed out|timeout/iu.test(error.message);
}

async function readBoundedTelegramText(response, maxBytes) {
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
                    throw new TelegramBotError('Telegram API response exceeded maximum size limit', {
                        status: response.status,
                        retriable: false
                    });
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
        throw new TelegramBotError('Telegram API response exceeded maximum size limit', {
            status: response.status,
            retriable: false
        });
    }
    return text || '';
}

async function postTelegramJson(url, payload, timeoutMs, signal) {
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify(payload);
    if (hasRuntimeHttpOp()) {
        let raw;
        try {
            raw = await globalThis.Deno.core.ops.op_http_request(String(url), {
                method: 'POST',
                headers,
                body,
                redirect: 'manual',
                timeoutMs,
                maxResponseBytes: 1024 * 1024
            });
        } catch (error) {
            if (isRuntimeTimeoutError(error)) {
                throw new TelegramBotError(`Telegram request timed out after ${timeoutMs} ms`, {
                    retriable: true,
                    details: { timeoutMs }
                });
            }
            throw new TelegramBotError('Telegram request failed', { retriable: true });
        }
        const status = Number(raw?.status) || 0;
        if (status >= 300 && status < 400) {
            throw new TelegramBotError('Telegram request failed', {
                status,
                retriable: true
            });
        }
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => decodeRuntimeBodyUtf8(raw)
        };
    }
    return fetch(url, {
        method: 'POST',
        headers,
        body,
        signal,
        redirect: 'error'
    });
}

if (typeof module !== 'undefined') {
    module.exports = { execute };
}
execute;
