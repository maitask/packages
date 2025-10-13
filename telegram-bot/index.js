/**
 * Telegram Bot API Integration
 * Send messages via Telegram Bot API to users and groups
 * Documentation: https://core.telegram.org/bots/api
 */

async function execute(input, options = {}, context = {}) {
    try {
        const config = buildConfig(input, options, context);
        ensureFetch('telegram-bot');

        // Validate required fields
        if (!config.bot_token) {
            throw new Error('bot_token is required');
        }
        if (!config.chat_id) {
            throw new Error('chat_id is required (user ID, group ID, or channel username)');
        }

        // Prepare message content
        let messageText = config.text;
        if (!messageText && typeof input === 'string') {
            messageText = input;
        } else if (!messageText && typeof input === 'object') {
            messageText = JSON.stringify(input, null, 2);
        } else if (!messageText) {
            throw new Error('Message text is required');
        }

        // Send based on message type
        if (config.message_type === 'photo') {
            return await sendPhoto(config, messageText);
        } else if (config.message_type === 'document') {
            return await sendDocument(config, messageText);
        } else {
            return await sendMessage(config, messageText);
        }
    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message,
                code: 'TELEGRAM_ERROR',
                type: 'TelegramBotError'
            }
        };
    }
}

function buildConfig(input, options, context) {
    return {
        // Required
        bot_token: options.bot_token || context.bot_token || context?.secrets?.TELEGRAM_BOT_TOKEN,
        chat_id: options.chat_id || context.chat_id,

        // Message content
        text: options.text,
        message_type: options.message_type || 'text', // text, photo, document

        // Optional message parameters
        parse_mode: options.parse_mode || 'Markdown', // Markdown, MarkdownV2, HTML
        reply_to_message_id: options.reply_to_message_id,
        disable_notification: options.disable_notification || false,
        disable_web_page_preview: options.disable_web_page_preview,
        reply_markup: options.reply_markup, // InlineKeyboardMarkup or ReplyKeyboardMarkup

        // Photo/document specific
        file_url: options.file_url, // For photo/document uploads
        caption: options.caption,

        // System
        timeout: options.timeout || 30000
    };
}

async function sendMessage(config, text) {
    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
    const payload = {
        chat_id: config.chat_id,
        text: text,
        parse_mode: config.parse_mode,
        reply_to_message_id: config.reply_to_message_id,
        disable_notification: config.disable_notification,
        disable_web_page_preview: config.disable_web_page_preview,
        reply_markup: config.reply_markup || undefined
    };

    // Remove undefined values
    Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    });

    const result = await telegramRequest(url, payload, config.timeout);

    return {
        success: true,
        message_id: result.message_id,
        chat_id: result.chat?.id,
        data: result,
        metadata: {
            version: '0.1.0',
            timestamp: new Date().toISOString(),
            method: 'sendMessage'
        }
    };
}

async function sendPhoto(config, caption) {
    if (!config.file_url) {
        throw new Error('file_url is required for photo messages');
    }

    const url = `https://api.telegram.org/bot${config.bot_token}/sendPhoto`;
    const formData = {
        chat_id: config.chat_id,
        photo: config.file_url,
        caption: caption,
        parse_mode: config.parse_mode,
        reply_to_message_id: config.reply_to_message_id,
        disable_notification: config.disable_notification,
        reply_markup: config.reply_markup || undefined
    };

    // Remove undefined values
    Object.keys(formData).forEach(key => {
        if (formData[key] === undefined) {
            delete formData[key];
        }
    });

    const result = await telegramRequest(url, formData, config.timeout);

    return {
        success: true,
        message_id: result.message_id,
        chat_id: result.chat?.id,
        data: result,
        metadata: {
            version: '0.1.0',
            timestamp: new Date().toISOString(),
            method: 'sendPhoto'
        }
    };
}

async function sendDocument(config, caption) {
    if (!config.file_url) {
        throw new Error('file_url is required for document messages');
    }

    const url = `https://api.telegram.org/bot${config.bot_token}/sendDocument`;
    const formData = {
        chat_id: config.chat_id,
        document: config.file_url,
        caption: caption,
        parse_mode: config.parse_mode,
        reply_to_message_id: config.reply_to_message_id,
        disable_notification: config.disable_notification,
        reply_markup: config.reply_markup || undefined
    };

    // Remove undefined values
    Object.keys(formData).forEach(key => {
        if (formData[key] === undefined) {
            delete formData[key];
        }
    });

    const result = await telegramRequest(url, formData, config.timeout);

    return {
        success: true,
        message_id: result.message_id,
        chat_id: result.chat?.id,
        data: result,
        metadata: {
            version: '0.1.0',
            timestamp: new Date().toISOString(),
            method: 'sendDocument'
        }
    };
}

async function telegramRequest(url, payload, timeout) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId = null;

    if (controller && timeout) {
        timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller ? controller.signal : undefined
        });

        const text = await response.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (err) {
            throw new Error(`Telegram API returned non-JSON response: ${text}`);
        }

        if (!response.ok || data.ok === false) {
            const description = data && data.description ? data.description : text;
            throw new Error(`Telegram API error: ${response.status} - ${description}`);
        }

        return data.result;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Telegram request timed out');
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is unavailable. Please run @maitask/${packageName} on Node.js 18 or newer.`);
    }
}

execute;
