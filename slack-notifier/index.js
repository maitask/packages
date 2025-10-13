/**
 * @maitask/slack-notifier
 * Send notifications and messages to Slack channels via incoming webhooks
 *
 * Features:
 * - Simple text messages
 * - Rich messages with Block Kit
 * - Attachments with fields and colors
 * - Thread replies support
 * - Markdown formatting
 * - Custom bot name and icon
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for Slack notifications
 * @param {Object|string} input - Message data or text string
 * @param {Object} options - Configuration options
 * @param {Object} context - Execution context
 * @returns {Object} Result of the notification
 */
async function execute(input, options = {}, context = {}) {
    try {
        const config = buildConfig(input, options, context);

        // Validate webhook URL
        if (!config.webhook_url) {
            throw new Error('Slack webhook URL is required (options.webhook_url or SLACK_WEBHOOK_URL)');
        }

        // Validate message content
        if (!config.text && !config.blocks && !config.attachments) {
            throw new Error('At least one of text, blocks, or attachments is required');
        }

        // Build Slack payload
        const payload = buildSlackPayload(config);

        // Send message via webhook
        ensureFetch('slack-notifier');
        const response = await sendSlackMessage(config.webhook_url, payload);

        return {
            success: true,
            notifier: 'slack',
            message: 'Slack notification sent successfully',
            data: {
                webhook: maskWebhookUrl(config.webhook_url),
                channel: config.channel || 'default',
                username: config.username,
                icon: config.icon_emoji || config.icon_url,
                has_blocks: !!config.blocks,
                has_attachments: !!config.attachments,
                thread_ts: config.thread_ts,
                sent_at: new Date().toISOString()
            },
            metadata: {
                response_status: response.status,
                response_time_ms: response.responseTime,
                version: '0.1.0'
            }
        };

    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown Slack notification error',
                code: 'SLACK_ERROR',
                type: 'SlackNotificationError'
            },
            metadata: {
                webhook: options.webhook_url ? maskWebhookUrl(options.webhook_url) : null,
                sent_at: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

/**
 * Build configuration from input, options, and context
 */
function buildConfig(input, options, context) {
    // Merge configuration sources
    const merged = Object.assign(
        {},
        typeof input === 'object' && !Array.isArray(input) ? input : {},
        options || {}
    );

    // Handle simple string input as message text
    if (typeof input === 'string') {
        merged.text = input;
    }

    return {
        webhook_url: merged.webhook_url || context?.secrets?.SLACK_WEBHOOK_URL,
        text: merged.text || merged.message,
        blocks: merged.blocks,
        attachments: merged.attachments,
        thread_ts: merged.thread_ts,
        channel: merged.channel,
        username: merged.username || 'Maitask Bot',
        icon_emoji: merged.icon_emoji || ':robot_face:',
        icon_url: merged.icon_url,
        link_names: merged.link_names !== false,
        mrkdwn: merged.mrkdwn !== false
    };
}

/**
 * Build Slack message payload according to API specification
 */
function buildSlackPayload(config) {
    const payload = {};

    // Basic text message (fallback for notifications)
    if (config.text) {
        payload.text = config.text;
    }

    // Block Kit layout (modern approach)
    if (config.blocks) {
        payload.blocks = config.blocks;
    }

    // Attachments (legacy but still supported)
    if (config.attachments) {
        payload.attachments = config.attachments;
    }

    // Thread replies
    if (config.thread_ts) {
        payload.thread_ts = config.thread_ts;
    }

    // Channel override (if supported by webhook)
    if (config.channel) {
        payload.channel = config.channel;
    }

    // Bot customization
    payload.username = config.username;

    if (config.icon_emoji) {
        payload.icon_emoji = config.icon_emoji;
    }

    if (config.icon_url) {
        payload.icon_url = config.icon_url;
    }

    // Formatting options
    payload.link_names = config.link_names;
    payload.mrkdwn = config.mrkdwn;

    return payload;
}

/**
 * Send message to Slack via webhook
 */
async function sendSlackMessage(webhookUrl, payload) {
    const startTime = Date.now();

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseTime = Date.now() - startTime;
        const bodyText = await response.text();

        if (!response.ok || bodyText.trim().toLowerCase() !== 'ok') {
            let errorMessage = `Slack API error: ${response.status}`;
            if (bodyText) {
                errorMessage += ` - ${bodyText}`;
            }
            throw new Error(errorMessage);
        }

        return {
            status: response.status,
            responseTime: responseTime
        };

    } catch (error) {
        throw new Error(`Failed to send Slack message: ${error.message}`);
    }
}

/**
 * Mask webhook URL for security
 */
function maskWebhookUrl(url) {
    if (!url) return null;

    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');

        // Mask the last 3 parts (T.../B.../token)
        if (pathParts.length >= 3) {
            const maskedParts = pathParts.slice(0, -3);
            maskedParts.push('T***', 'B***', '***');
            return `${urlObj.protocol}//${urlObj.host}${maskedParts.join('/')}`;
        }

        return `${urlObj.protocol}//${urlObj.host}/services/***`;
    } catch (error) {
        return 'https://hooks.slack.com/services/***';
    }
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is unavailable. Please run @maitask/${packageName} on Node.js 18 or newer.`);
    }
}

execute;
