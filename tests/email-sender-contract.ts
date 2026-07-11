import {
  execute,
  type EmailResult,
  type MailgunEmailInput,
  type MailgunEmailOptions,
  type SendGridEmailInput,
  type SendGridEmailOptions
} from '../email-sender';

const sendGridInput = {
  provider: 'sendgrid',
  from: { email: 'sender@example.com', name: 'Maitask' },
  to: [{ email: 'to@example.com' }],
  cc: [{ email: 'cc@example.com' }],
  bcc: [{ email: 'bcc@example.com' }],
  replyTo: { email: 'reply@example.com' },
  subject: 'Production notification',
  content: { text: 'Plain text', html: '<p>HTML</p>' },
  headers: { 'X-Trace-Id': 'trace-1' },
  tags: ['production'],
  metadata: { workflowId: 'workflow-1' },
  attachments: [{
    filename: 'artifact.bin',
    contentType: 'application/octet-stream',
    bodyBase64: 'AP9B'
  }]
} as const satisfies SendGridEmailInput;

const sendGridOptions = {
  apiKeySecret: 'SENDGRID_API_KEY',
  timeoutMs: 30_000,
  maxResponseBytes: 64 * 1024,
  secrets: { SENDGRID_API_KEY: 'configured-secret' }
} as const satisfies SendGridEmailOptions;

const result: Promise<EmailResult> = execute(sendGridInput, sendGridOptions, {
  executionId: 'execution-1'
});

const mailgunInput = {
  provider: 'mailgun',
  from: { email: 'sender@example.com' },
  to: [{ email: 'recipient@example.com' }],
  providerTemplate: {
    id: 'production-template',
    variables: { name: 'Maitask', count: 2 }
  }
} as const satisfies MailgunEmailInput;

const mailgunOptions = {
  domain: 'mg.example.com',
  apiKeySecret: 'MAILGUN_API_KEY',
  secrets: { MAILGUN_API_KEY: 'configured-secret' }
} as const satisfies MailgunEmailOptions;

execute(mailgunInput, mailgunOptions);

result.then(value => {
  if (value.success) {
    const count: number = value.data.items[0].data.recipientCount;
    const provider: 'sendgrid' | 'mailgun' = value.metadata.provider;
    void [count, provider];

    // @ts-expect-error receipts are readonly
    value.data.items[0].data.recipientCount = 0;
  } else {
    const code: string = value.error.code;
    void code;
  }
});

// @ts-expect-error SMTP is not executable in managed Runtime
execute({ ...sendGridInput, provider: 'smtp' }, sendGridOptions);

// @ts-expect-error legacy credentials are not accepted in business input
execute({ ...sendGridInput, api_key: 'literal-secret' }, sendGridOptions);

// @ts-expect-error snake_case aliases are removed
execute({ ...sendGridInput, reply_to: { email: 'reply@example.com' } }, sendGridOptions);

// @ts-expect-error content modes are mutually exclusive
execute({ ...sendGridInput, template: { text: 'Hello {{name}}', variables: { name: 'Maitask' } } }, sendGridOptions);

// @ts-expect-error direct content requires a subject
execute({
  provider: 'sendgrid',
  from: { email: 'sender@example.com' },
  to: [{ email: 'recipient@example.com' }],
  content: { text: 'Missing subject' }
}, sendGridOptions);

// @ts-expect-error Mailgun requires a trusted domain option
execute(mailgunInput, { secrets: { MAILGUN_API_KEY: 'configured-secret' } });

// @ts-expect-error SendGrid options cannot contain a Mailgun domain
execute(sendGridInput, { ...sendGridOptions, domain: 'mg.example.com' });

execute({
  ...sendGridInput,
  // @ts-expect-error provider-control headers are not message headers
  headers: { 'X-SMTPAPI': '{}' }
}, sendGridOptions);

// @ts-expect-error retry controls are intentionally absent because delivery POSTs are never replayed
execute(sendGridInput, { ...sendGridOptions, retries: 3 });
