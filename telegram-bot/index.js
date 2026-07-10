/**
 * Telegram Bot API Integration
 * Send messages via Telegram Bot API to users and groups
 * Documentation: https://core.telegram.org/bots/api
 */

const PACKAGE_NAME = '@maitask/telegram-bot';
const PACKAGE_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const RETRIABLE_STATUSES = new Set([408, 425, 429]);

class TelegramBotError extends Error {
    constructor(message, { status, retriable, details } = {}) {
        super(message);
        this.name = 'TelegramBotError';
        this.status = status;
        this.retriable = retriable;
        this.details = details;
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
            `${config.baseUrl}/bot${config.botToken}/${method}`,
            payload,
            config.timeoutMs
        );

        return {
            success: true,
            data: {
                messageId: message?.message_id,
                chatId: message?.chat?.id,
                message
            },
            metadata: buildMetadata({ method })
        };
    } catch (error) {
        return buildErrorResult(error, config?.botToken);
    }
}

function buildConfig(input, options, context) {
    const content = normalizeInput(input);
    const messageType = options.messageType ?? 'text';
    const botToken = options.botToken ?? context?.secrets?.TELEGRAM_BOT_TOKEN;
    const chatId = options.chatId;

    if (!['text', 'photo', 'document'].includes(messageType)) {
        throw new TelegramBotError('messageType must be text, photo, or document');
    }
    if (typeof botToken !== 'string' || botToken.length === 0) {
        throw new TelegramBotError('botToken is required');
    }
    if (chatId === undefined || chatId === null || chatId === '') {
        throw new TelegramBotError('chatId is required (user ID, group ID, or channel username)');
    }
    if (messageType === 'text' && !hasStringContent(content.text)) {
        throw new TelegramBotError('Text content is required for text messages');
    }
    if (messageType !== 'text' && !hasStringContent(content.fileUrl)) {
        throw new TelegramBotError(`fileUrl is required for ${messageType} messages`);
    }

    return {
        baseUrl: normalizeBaseUrl(
            options.baseUrl ?? context?.env?.TELEGRAM_API_BASE_URL ?? DEFAULT_BASE_URL
        ),
        botToken,
        chatId,
        messageType,
        text: content.text,
        fileUrl: content.fileUrl,
        caption: content.caption ?? content.text,
        parseMode: options.parseMode,
        replyToMessageId: options.replyToMessageId,
        disableNotification: options.disableNotification,
        disableWebPagePreview: options.disableWebPagePreview,
        replyMarkup: options.replyMarkup,
        timeoutMs: normalizeTimeout(options.timeoutMs)
    };
}

function normalizeInput(input) {
    if (typeof input === 'string') {
        return { text: input };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TelegramBotError('Input must be a string or an object');
    }

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
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new TelegramBotError('base URL must be an absolute HTTP or HTTPS URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) {
        throw new TelegramBotError('base URL must be an absolute HTTP or HTTPS URL');
    }

    return parsed.toString().replace(/\/+$/, '');
}

function normalizeTimeout(value) {
    if (value === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }

    const timeoutMs = Number(value);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TelegramBotError('timeoutMs must be a positive number');
    }

    return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

function hasStringContent(value) {
    return typeof value === 'string' && value.length > 0;
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

async function telegramRequest(url, payload, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        const responseText = await response.text();
        let responseData;

        try {
            responseData = responseText ? JSON.parse(responseText) : {};
        } catch {
            throw new TelegramBotError('Telegram API returned a non-JSON response', {
                status: response.status,
                retriable: isRetriableStatus(response.status)
            });
        }

        if (!response.ok || responseData.ok === false) {
            const description = responseData.description || 'Telegram API request failed';
            const retryAfterSeconds = Number(responseData.parameters?.retry_after);
            const details = Number.isFinite(retryAfterSeconds)
                ? { retryAfterSeconds }
                : undefined;
            throw new TelegramBotError(
                `Telegram API error: ${response.status} - ${description}`,
                {
                    status: response.status,
                    retriable: isRetriableStatus(response.status),
                    details
                }
            );
        }

        return responseData.result;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new TelegramBotError(`Telegram request timed out after ${timeoutMs} ms`, {
                retriable: true,
                details: { timeoutMs }
            });
        }
        if (error instanceof TelegramBotError) {
            throw error;
        }
        throw new TelegramBotError('Telegram request failed');
    } finally {
        clearTimeout(timeoutId);
    }
}

function isRetriableStatus(status) {
    return RETRIABLE_STATUSES.has(status) || status >= 500;
}

function buildErrorResult(error, botToken) {
    const telegramError =
        error instanceof TelegramBotError
            ? error
            : new TelegramBotError(error?.message || 'Telegram request failed');
    const safeMessage = redactToken(telegramError.message, botToken);
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

function redactToken(message, botToken) {
    if (!botToken || typeof message !== 'string') {
        return message;
    }
    return message.split(botToken).join('[REDACTED]');
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
    if (typeof fetch !== 'function') {
        throw new TelegramBotError(
            'Global fetch API is unavailable. Please run @maitask/telegram-bot on Node.js 18 or newer.'
        );
    }
}

if (typeof module !== 'undefined') {
    module.exports = { execute };
}
execute;
