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
            data: {
                message: 'Email sent successfully via ' + config.provider,
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
    ensureFetch('email-sender');

    switch (provider) {
        case 'sendgrid':
            return await sendViaSendGrid(emailData, config);
        case 'mailgun':
            return await sendViaMailgun(emailData, config);
        case 'smtp':
            return await sendViaSMTP(emailData, config);
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

async function sendViaSMTP(emailData, config) {
    if (!config.smtp_config || !config.smtp_config.host) {
        throw new Error('SMTP configuration with host is required');
    }

    var smtpConfig = config.smtp_config;

    // Validate required SMTP configuration
    if (!smtpConfig.port) {
        throw new Error('SMTP port is required');
    }

    var net;
    var tls;
    try {
        net = await import('node:net');
        tls = await import('node:tls');
    } catch (error) {
        throw new Error('SMTP provider requires a Node.js-compatible runtime with node:net and node:tls support');
    }

    var port = Number(smtpConfig.port);
    var implicitTls = smtpConfig.secure === true && port === 465;
    var useStartTls = smtpConfig.starttls === true || (smtpConfig.secure === true && !implicitTls);
    var timeoutMs = Number(smtpConfig.timeout_ms || smtpConfig.timeout || 30000);
    var host = smtpConfig.host;
    var socket = implicitTls
        ? tls.connect({ host: host, port: port, servername: host, rejectUnauthorized: smtpConfig.reject_unauthorized !== false })
        : net.connect({ host: host, port: port });

    var client = createSmtpConnection(socket, timeoutMs);
    var messageId = buildMessageId(config.from.email);

    try {
        await client.expect([220]);
        await client.command('EHLO ' + (smtpConfig.helo || 'maitask.local'), [250]);

        if (useStartTls) {
            await client.command('STARTTLS', [220]);
            socket = tls.connect({
                socket: socket,
                servername: host,
                rejectUnauthorized: smtpConfig.reject_unauthorized !== false
            });
            client = createSmtpConnection(socket, timeoutMs);
            await client.command('EHLO ' + (smtpConfig.helo || 'maitask.local'), [250]);
        }

        if (smtpConfig.username || smtpConfig.user) {
            var username = smtpConfig.username || smtpConfig.user;
            var password = smtpConfig.password || smtpConfig.pass;
            if (!password) {
                throw new Error('SMTP password is required when username is provided');
            }
            await client.command('AUTH LOGIN', [334]);
            await client.command(base64Encode(username), [334]);
            await client.command(base64Encode(password), [235]);
        }

        await client.command('MAIL FROM:<' + config.from.email + '>', [250]);

        var recipients = config.to.map(function(recipient) {
            return typeof recipient === 'string' ? recipient : recipient.email;
        });
        for (var i = 0; i < recipients.length; i++) {
            await client.command('RCPT TO:<' + recipients[i] + '>', [250, 251]);
        }

        await client.command('DATA', [354]);
        await client.command(buildMimeMessage(config, emailData, messageId), [250], true);
        await client.command('QUIT', [221]).catch(function() {});

        return {
            message_id: messageId,
            provider_response: 'smtp:' + host + ':' + port
        };
    } finally {
        client.close();
    }
}

function createSmtpConnection(socket, timeoutMs) {
    var buffer = '';
    var pending = [];
    var closed = false;

    socket.setTimeout(timeoutMs);
    socket.on('data', function(chunk) {
        buffer += chunk.toString('utf8');
        flush();
    });
    socket.on('error', function(error) {
        fail(error);
    });
    socket.on('timeout', function() {
        fail(new Error('SMTP connection timed out'));
        socket.destroy();
    });
    socket.on('close', function() {
        closed = true;
        flush();
    });

    function flush() {
        while (pending.length > 0) {
            var response = readResponse();
            if (!response) {
                if (closed) {
                    pending.shift().reject(new Error('SMTP connection closed before response'));
                }
                return;
            }
            pending.shift().resolve(response);
        }
    }

    function fail(error) {
        while (pending.length > 0) {
            pending.shift().reject(error);
        }
    }

    function readResponse() {
        var lines = buffer.split(/\r?\n/);
        var completeIndex = -1;
        for (var i = 0; i < lines.length; i++) {
            if (/^\d{3}\s/.test(lines[i])) {
                completeIndex = i;
                break;
            }
        }
        if (completeIndex === -1) return null;

        var responseLines = lines.slice(0, completeIndex + 1);
        buffer = lines.slice(completeIndex + 1).join('\n');
        var lastLine = responseLines[responseLines.length - 1];
        return {
            code: Number(lastLine.slice(0, 3)),
            message: responseLines.join('\n')
        };
    }

    function nextResponse() {
        return new Promise(function(resolve, reject) {
            pending.push({ resolve: resolve, reject: reject });
            flush();
        });
    }

    return {
        expect: async function(expectedCodes) {
            var response = await nextResponse();
            if (expectedCodes.indexOf(response.code) === -1) {
                throw new Error('Unexpected SMTP response ' + response.code + ': ' + response.message);
            }
            return response;
        },
        command: async function(command, expectedCodes, rawData) {
            socket.write(rawData ? dotStuff(command) + '\r\n.\r\n' : command + '\r\n');
            return this.expect(expectedCodes);
        },
        close: function() {
            if (!socket.destroyed) socket.end();
        }
    };
}

function buildMimeMessage(config, emailData, messageId) {
    var from = formatAddress(config.from);
    var to = config.to.map(formatAddress).join(', ');
    var headers = [
        'From: ' + from,
        'To: ' + to,
        'Subject: ' + encodeHeader(config.subject),
        'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + messageId + '>',
        'MIME-Version: 1.0'
    ];

    if (emailData.html && emailData.text) {
        var boundary = 'maitask-' + Math.random().toString(16).slice(2);
        headers.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
        return headers.join('\r\n') + '\r\n\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Type: text/plain; charset=UTF-8\r\n' +
            'Content-Transfer-Encoding: 8bit\r\n\r\n' +
            emailData.text + '\r\n' +
            '--' + boundary + '\r\n' +
            'Content-Type: text/html; charset=UTF-8\r\n' +
            'Content-Transfer-Encoding: 8bit\r\n\r\n' +
            emailData.html + '\r\n' +
            '--' + boundary + '--';
    }

    if (emailData.html) {
        headers.push('Content-Type: text/html; charset=UTF-8');
        headers.push('Content-Transfer-Encoding: 8bit');
        return headers.join('\r\n') + '\r\n\r\n' + emailData.html;
    }

    headers.push('Content-Type: text/plain; charset=UTF-8');
    headers.push('Content-Transfer-Encoding: 8bit');
    return headers.join('\r\n') + '\r\n\r\n' + (emailData.text || '');
}

function formatAddress(address) {
    if (typeof address === 'string') return address;
    return address.name ? encodeHeader(address.name) + ' <' + address.email + '>' : address.email;
}

function encodeHeader(value) {
    if (/^[\x00-\x7F]*$/.test(value)) return value;
    return '=?UTF-8?B?' + base64Encode(value) + '?=';
}

function buildMessageId(fromEmail) {
    var domain = String(fromEmail || 'maitask.local').split('@')[1] || 'maitask.local';
    return Date.now().toString(36) + '.' + Math.random().toString(36).slice(2) + '@' + domain;
}

function dotStuff(message) {
    return String(message).replace(/^\./gm, '..');
}

function base64Encode(value) {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(String(value), 'utf8').toString('base64');
    }
    if (typeof btoa === 'function') {
        return btoa(unescape(encodeURIComponent(String(value))));
    }
    throw new Error('Base64 encoding is not available in this runtime');
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

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;
