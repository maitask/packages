# @maitask/email-sender

Powerful email sending service with multiple providers and templates.

## Features

- **Multiple Providers**: Support for SendGrid, Mailgun, and SMTP
- **Template Engine**: Built-in templates with variable substitution
- **HTML & Text Email**: Support for both HTML and plain text content
- **Pre-built Templates**: Notification, alert, and report templates
- **Secure Configuration**: API key and credential management
- **Error Handling**: Comprehensive error reporting and retry logic
- **Batch Recipients**: Send to multiple recipients efficiently
- **Format Conversion**: Automatic HTML-to-text conversion

## Installation

```bash
npm install @maitask/email-sender
```

## Usage

### Basic Email Sending

```javascript
const result = execute({
  provider: "sendgrid",
  api_key: "your-api-key",
  from: {
    email: "sender@example.com",
    name: "Your App"
  },
  to: [
    { email: "user@example.com", name: "User Name" }
  ],
  subject: "Welcome to our service!",
  html: "<h1>Welcome!</h1><p>Thanks for joining us.</p>",
  text: "Welcome! Thanks for joining us."
});

console.log(result.success); // true
console.log(result.data.message_id); // Email message ID
```

### Using Templates

```javascript
const result = execute({
  provider: "sendgrid",
  api_key: "your-api-key",
  from: { email: "alerts@example.com", name: "Alert System" },
  to: [{ email: "admin@example.com" }],
  subject: "System Alert",
  template: "alert",
  template_data: {
    alert_type: "High CPU Usage",
    message: "Server CPU usage exceeded 90%",
    timestamp: new Date().toISOString(),
    details: "CPU: 95%, Memory: 78%, Disk: 45%"
  }
});
```

### Custom HTML Template

```javascript
const customTemplate = `
<html>
  <body style="font-family: Arial, sans-serif;">
    <h1>Hello {{name}}!</h1>
    <p>Your order #{{order_id}} has been {{status}}.</p>
    <div style="background: #f0f0f0; padding: 20px;">
      <p><strong>Total:</strong> ${{total}}</p>
      <p><strong>Delivery:</strong> {{delivery_date}}</p>
    </div>
  </body>
</html>
`;

const result = execute({
  provider: "mailgun",
  api_key: "your-api-key",
  domain: "your-domain.com",
  from: { email: "orders@shop.com", name: "Shop Orders" },
  to: [{ email: "customer@example.com", name: "John Doe" }],
  subject: "Order Update",
  template: customTemplate,
  template_data: {
    name: "John",
    order_id: "12345",
    status: "shipped",
    total: "99.99",
    delivery_date: "March 15, 2023"
  }
});
```

## Provider Configuration

### SendGrid

```javascript
{
  provider: "sendgrid",
  api_key: "SG.your-api-key",
  from: { email: "sender@example.com", name: "Your App" },
  to: [{ email: "recipient@example.com" }],
  subject: "Your Subject",
  html: "<p>Your HTML content</p>"
}
```

### Mailgun

```javascript
{
  provider: "mailgun",
  api_key: "key-your-api-key",
  domain: "your-domain.mailgun.org",
  from: { email: "sender@your-domain.com", name: "Your App" },
  to: [{ email: "recipient@example.com" }],
  subject: "Your Subject",
  html: "<p>Your HTML content</p>"
}
```

### SMTP (Basic Configuration)

```javascript
{
  provider: "smtp",
  smtp_config: {
    host: "smtp.gmail.com",
    port: 587,
    username: "your-email@gmail.com",
    password: "your-app-password",
    secure: true
  },
  from: { email: "your-email@gmail.com", name: "Your App" },
  to: [{ email: "recipient@example.com" }],
  subject: "Your Subject",
  text: "Your plain text content"
}
```

## Built-in Templates

### Notification Template

```javascript
{
  template: "notification",
  template_data: {
    title: "System Notification",
    message: "Your backup completed successfully",
    details: "Backup size: 2.5GB\nDuration: 5 minutes",
    timestamp: new Date().toISOString()
  }
}
```

### Alert Template

```javascript
{
  template: "alert",
  template_data: {
    alert_type: "Security Alert",
    message: "Unusual login detected",
    timestamp: new Date().toISOString(),
    details: "IP: 192.168.1.100\nLocation: New York, US"
  }
}
```

### Report Template

```javascript
{
  template: "report",
  template_data: {
    report_title: "Weekly Analytics",
    summary: "Here's your weekly performance summary",
    stats: {
      "Page Views": "1,234",
      "Unique Visitors": "892",
      "Conversion Rate": "3.2%",
      "Revenue": "$1,567"
    }
  }
}
```

## Configuration Options

### Core Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `provider` | string | Yes | Email provider: "sendgrid", "mailgun", or "smtp" |
| `from` | object | Yes | Sender information with email and optional name |
| `to` | array | Yes | Array of recipient objects with email and optional name |
| `subject` | string | Yes | Email subject line |

### Content Options

| Option | Type | Description |
|--------|------|-------------|
| `html` | string | HTML email content |
| `text` | string | Plain text email content |
| `template` | string | Template name or HTML template string |
| `template_data` | object | Variables for template substitution |

### Provider-Specific Options

| Provider | Required Options | Optional Options |
|----------|------------------|------------------|
| SendGrid | `api_key` | - |
| Mailgun | `api_key`, `domain` | - |
| SMTP | `smtp_config` | - |

### SMTP Configuration

```javascript
{
  smtp_config: {
    host: "smtp.example.com",     // SMTP server hostname
    port: 587,                    // SMTP port (587 for TLS, 465 for SSL)
    username: "user@example.com", // SMTP username
    password: "password",         // SMTP password
    secure: true                  // Use TLS/SSL
  }
}
```

## Output Format

### Success Response

```javascript
{
  success: true,
  message: "Email sent successfully via sendgrid",
  data: {
    provider: "sendgrid",
    from: "sender@example.com",
    to: ["recipient1@example.com", "recipient2@example.com"],
    subject: "Your Subject",
    recipients_count: 2,
    has_html: true,
    has_text: true,
    sent_at: "2023-01-15T10:30:00.000Z",
    version: "0.1.0"
  },
  metadata: {
    message_id: "msg_12345",
    provider_response: 202,
    version: "0.1.0"
  }
}
```

### Error Response

```javascript
{
  success: false,
  error: {
    message: "SendGrid API error: 401 - Unauthorized",
    code: "EMAIL_SEND_ERROR",
    type: "EmailSendingError",
    provider: "sendgrid",
    details: null
  },
  metadata: {
    attempted_at: "2023-01-15T10:30:00.000Z",
    version: "0.1.0"
  }
}
```

## Advanced Examples

### Bulk Email with Different Content

```javascript
const recipients = [
  { email: "user1@example.com", name: "Alice" },
  { email: "user2@example.com", name: "Bob" },
  { email: "user3@example.com", name: "Charlie" }
];

// Send personalized emails
recipients.forEach(recipient => {
  execute({
    provider: "sendgrid",
    api_key: "your-api-key",
    from: { email: "newsletter@example.com", name: "Newsletter" },
    to: [recipient],
    subject: `Hello ${recipient.name}!`,
    template: "notification",
    template_data: {
      title: `Welcome ${recipient.name}`,
      message: "Thanks for subscribing to our newsletter!",
      timestamp: new Date().toISOString()
    }
  });
});
```

### Error Handling and Retry

```javascript
const sendEmailWithRetry = async (emailConfig, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = execute(emailConfig);

      if (result.success) {
        console.log('Email sent successfully:', result.data.message_id);
        return result;
      } else {
        console.log(`Attempt ${attempt} failed:`, result.error.message);

        if (attempt === maxRetries) {
          throw new Error(`Failed to send email after ${maxRetries} attempts`);
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    } catch (error) {
      console.error(`Attempt ${attempt} error:`, error.message);

      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
};
```

### Template with Conditional Content

```javascript
const generateDynamicTemplate = (userType, userData) => {
  let template = `
    <html>
      <body style="font-family: Arial, sans-serif;">
        <h1>Hello {{name}}!</h1>
        <p>{{welcome_message}}</p>
  `;

  if (userType === 'premium') {
    template += `
        <div style="background: gold; padding: 15px; border-radius: 5px;">
          <h2>🌟 Premium Member Benefits</h2>
          <ul>
            <li>Priority support</li>
            <li>Advanced features</li>
            <li>Monthly reports</li>
          </ul>
        </div>
    `;
  }

  template += `
        <p>Best regards,<br>The Team</p>
      </body>
    </html>
  `;

  return template;
};

const result = execute({
  provider: "sendgrid",
  api_key: "your-api-key",
  from: { email: "welcome@example.com" },
  to: [{ email: "user@example.com", name: "John" }],
  subject: "Welcome to our platform!",
  template: generateDynamicTemplate('premium', userData),
  template_data: {
    name: "John",
    welcome_message: "We're excited to have you on board!"
  }
});
```

### Multi-Provider Fallback

```javascript
const sendWithFallback = (emailData) => {
  const providers = [
    { provider: "sendgrid", api_key: "sg-key" },
    { provider: "mailgun", api_key: "mg-key", domain: "mg-domain.com" }
  ];

  for (const providerConfig of providers) {
    try {
      const result = execute({
        ...emailData,
        ...providerConfig
      });

      if (result.success) {
        console.log(`Email sent via ${providerConfig.provider}`);
        return result;
      }
    } catch (error) {
      console.log(`${providerConfig.provider} failed:`, error.message);
    }
  }

  throw new Error('All email providers failed');
};
```

## Security Considerations

- **API Keys**: Store API keys as environment variables or in secure configuration
- **Rate Limiting**: Respect provider rate limits to avoid service disruption
- **Input Validation**: Validate email addresses and content before sending
- **Template Injection**: Sanitize template variables to prevent XSS
- **Error Logging**: Avoid logging sensitive information in error messages

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify API keys are correct and active
   - Check provider account status and billing

2. **Delivery Failures**
   - Validate recipient email addresses
   - Check sender domain reputation
   - Review provider-specific requirements

3. **Template Errors**
   - Ensure template variables match data provided
   - Check HTML syntax for custom templates
   - Verify template names for built-in templates

4. **Rate Limiting**
   - Implement delays between sends
   - Use provider-specific batch sending features
   - Monitor usage against provider limits

## Requirements

- Node.js >= 14.0.0
- Maitask Engine >= 1.0.0
- Valid email provider account (SendGrid, Mailgun, or SMTP server)

## License

MIT © Maitask Team

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add comprehensive tests
4. Submit a pull request

## Changelog

### 0.1.0

- Initial release
- SendGrid, Mailgun, and SMTP support
- HTML and text email capabilities
- Template engine with variable substitution
- Built-in notification, alert, and report templates
- Comprehensive error handling
- Multiple recipient support
