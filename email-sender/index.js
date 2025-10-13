/**
 * @maitask/email-sender
 * Powerful email sending service with multiple providers and templates
 *
 * Features:
 * - Multiple email providers (SendGrid, Mailgun, SMTP)
 * - HTML and text email support
 * - Template engine with variable substitution
 * - Built-in email templates (notification, alert, report)
 * - Comprehensive error handling
 * - Flexible configuration options
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for email sending
 * @param {Object} input - Email configuration and content
 * @param {Object} options - Sending options and provider settings
 * @param {Object} context - Execution context with secrets
 * @returns {Object} Email sending result with delivery confirmation
 */
async function execute(input, options, context) {
    console.log('Email Sender - Starting');

    var config = buildConfig(input, options, context);

    // Validate required fields
    if (!config.from || !config.from.email) {
        throw new Error('Sender email address is required');
    }
    if (!config.to || config.to.length === 0) {
        throw new Error('At least one recipient is required');
    }
    if (!config.subject) {
        throw new Error('Email subject is required');
    }

    try {
        var emailData = prepareEmailData(config);
        var result = await sendEmail(config.provider, emailData, config);

        return {
            success: true,
            message: 'Email sent successfully via ' + config.provider,
            data: {
                provider: config.provider,
                from: config.from.email,
                to: config.to.map(function(recipient) {
                    return typeof recipient === 'string' ? recipient : recipient.email;
                }),
                subject: config.subject,
                recipients_count: config.to.length,
                has_html: !!emailData.html,
                has_text: !!emailData.text,
                sent_at: new Date().toISOString(),
                version: '0.1.0'
            },
            metadata: {
                message_id: result.message_id || null,
                provider_response: result.provider_response || null,
                version: '0.1.0'
            }
        };

    } catch (error) {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown email sending error',
                code: 'EMAIL_SEND_ERROR',
                type: 'EmailSendingError',
                provider: config.provider,
                details: error.details || null
            },
            metadata: {
                attempted_at: new Date().toISOString(),
                version: '0.1.0'
            }
        };
    }
}

function buildConfig(input, options, context) {
    var source = mergeObjects(options || {}, input || {});

    return {
        provider: source.provider || 'sendgrid',
        api_key: source.api_key || (context && context.secrets && context.secrets.EMAIL_API_KEY),
        domain: source.domain || (context && context.secrets && context.secrets.MAILGUN_DOMAIN),
        smtp_config: source.smtp_config || {},
        from: source.from,
        to: Array.isArray(source.to) ? source.to : [source.to].filter(Boolean),
        subject: source.subject,
        template: source.template,
        template_data: source.template_data || {},
        html: source.html,
        text: source.text
    };
}

function prepareEmailData(config) {
    var html = config.html;
    var text = config.text;

    // Process template if provided
    if (config.template) {
        if (config.template.includes('<html>') || config.template.includes('<div>')) {
            // Template is HTML content
            html = processTemplate(config.template, config.template_data);
        } else {
            // Template is a template name - in real implementation, would fetch from template service
            html = processTemplate(getDefaultTemplate(config.template), config.template_data);
        }

        // Generate text version from HTML if not provided
        if (!text && html) {
            text = htmlToText(html);
        }
    }

    // Ensure we have at least some content
    if (!html && !text) {
        text = 'This email was sent from Maitask Engine.';
    }

    return {
        html: html,
        text: text
    };
}

function processTemplate(template, data) {
    let processed = template;

    // Simple template variable replacement {{variable}}
    Object.keys(data).forEach(key => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        processed = processed.replace(regex, data[key] || '');
    });

    return processed;
}

function getDefaultTemplate(templateName) {
    const templates = {
        'notification': `
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">{{title}}</h2>
                    <p>{{message}}</p>
                    {{#if details}}
                    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
                        <pre>{{details}}</pre>
                    </div>
                    {{/if}}
                    <hr style="margin: 20px 0;">
                    <p style="color: #666; font-size: 12px;">
                        Sent by Maitask Engine on {{timestamp}}
                    </p>
                </body>
            </html>
        `,
        'alert': `
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #ff4444; color: white; padding: 15px; border-radius: 5px;">
                        <h2 style="margin: 0;">⚠️ Alert: {{alert_type}}</h2>
                    </div>
                    <div style="padding: 15px;">
                        <p><strong>Message:</strong> {{message}}</p>
                        <p><strong>Time:</strong> {{timestamp}}</p>
                        {{#if details}}
                        <p><strong>Details:</strong></p>
                        <pre style="background-color: #f5f5f5; padding: 10px;">{{details}}</pre>
                        {{/if}}
                    </div>
                </body>
            </html>
        `,
        'report': `
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">📊 {{report_title}}</h2>
                    <p>{{summary}}</p>
                    {{#if stats}}
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        <tr style="background-color: #f5f5f5;">
                            <th style="padding: 10px; border: 1px solid #ddd;">Metric</th>
                            <th style="padding: 10px; border: 1px solid #ddd;">Value</th>
                        </tr>
                        {{#each stats}}
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;">{{@key}}</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">{{this}}</td>
                        </tr>
                        {{/each}}
                    </table>
                    {{/if}}
                </body>
            </html>
        `
    };

    return templates[templateName] || templates['notification'];
}

function htmlToText(html) {
    return html
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

async function sendEmail(provider, emailData, config) {
    console.log('Sending email via', provider);
    ensureFetch('email-sender');

    switch (provider) {
        case 'sendgrid':
            return await sendViaSendGrid(emailData, config);
        case 'mailgun':
            return await sendViaMailgun(emailData, config);
        case 'smtp':
            return sendViaSMTP(emailData, config);
        default:
            throw new Error('Unsupported email provider: ' + provider);
    }
}

async function sendViaSendGrid(emailData, config) {
    if (!config.api_key) {
        throw new Error('SendGrid API key is required');
    }

    var payload = {
        personalizations: [{
            to: config.to.map(function(recipient) {
                if (typeof recipient === 'string') {
                    return { email: recipient };
                }
                return {
                    email: recipient.email,
                    name: recipient.name
                };
            })
        }],
        from: {
            email: config.from.email,
            name: config.from.name
        },
        subject: config.subject,
        content: []
    };

    if (emailData.text) {
        payload.content.push({
            type: 'text/plain',
            value: emailData.text
        });
    }

    if (emailData.html) {
        payload.content.push({
            type: 'text/html',
            value: emailData.html
        });
    }

    var response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + config.api_key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        var errorBody = await safeReadText(response);
        throw new Error('SendGrid API error: ' + response.status + ' - ' + errorBody);
    }

    return {
        message_id: response.headers.get('x-message-id') || null,
        provider_response: response.status
    };
}

async function sendViaMailgun(emailData, config) {
    if (!config.api_key) {
        throw new Error('Mailgun API key is required');
    }

    if (!config.domain) {
        throw new Error('Mailgun domain is required');
    }

    var formData = new URLSearchParams();
    formData.append('from', config.from.name ? config.from.name + ' <' + config.from.email + '>' : config.from.email);
    formData.append('to', config.to.map(function(recipient) {
        if (typeof recipient === 'string') {
            return recipient;
        }
        return recipient.name ? recipient.name + ' <' + recipient.email + '>' : recipient.email;
    }).join(','));
    formData.append('subject', config.subject);

    if (emailData.text) {
        formData.append('text', emailData.text);
    }

    if (emailData.html) {
        formData.append('html', emailData.html);
    }

    var url = 'https://api.mailgun.net/v3/' + config.domain + '/messages';
    var authString = 'api:' + config.api_key;
    var base64Auth = Buffer.from(authString).toString('base64');

    var response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + base64Auth,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
    });

    var responseText = await safeReadText(response);
    if (!response.ok) {
        throw new Error('Mailgun API error: ' + response.status + ' - ' + responseText);
    }

    var responseData;
    try {
        responseData = responseText ? JSON.parse(responseText) : {};
    } catch (err) {
        responseData = { message: responseText };
    }

    return {
        message_id: responseData.id || null,
        provider_response: response.status
    };
}

function sendViaSMTP(emailData, config) {
    if (!config.smtp_config || !config.smtp_config.host) {
        throw new Error('SMTP configuration with host is required');
    }

    var smtpConfig = config.smtp_config;

    // Validate required SMTP configuration
    if (!smtpConfig.port) {
        throw new Error('SMTP port is required');
    }

    // Note: JavaScript runtime doesn't have built-in SMTP client
    // This would require a proper SMTP library or implementation
    throw new Error('SMTP sending requires a proper SMTP client library. Use SendGrid or Mailgun for cloud email sending.');
}

function mergeObjects(base, extra) {
    var result = {};
    Object.assign(result, base || {});
    Object.assign(result, extra || {});
    return result;
}

async function safeReadText(response) {
    try {
        return await response.text();
    } catch (err) {
        return '';
    }
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is unavailable. Please run ${packageName ? '@maitask/' + packageName : 'this package'} on Node.js 18 or newer.`);
    }
}

execute;
