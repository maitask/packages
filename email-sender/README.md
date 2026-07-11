# @maitask/email-sender

Credential-confined SendGrid and Mailgun delivery for Maitask Runtime. Version 1 validates and snapshots the complete message before contact, supports recipient privacy and exact attachments, renders safe local templates or provider-native templates, executes exactly one provider POST, and returns only a controlled receipt.

## Provider scope

The managed package supports:

- SendGrid v3 Mail Send over HTTPS.
- Mailgun v3 Messages over HTTPS, including multipart attachments.

SMTP is intentionally not exposed. Managed Maitask Runtime is a compact native worker sandbox with HTTP operations, not raw TCP or Node `net`/`tls` modules. The previous SMTP branch could run only in a separate Node process and was therefore not a real managed-package capability. SMTP environments should expose a separately managed HTTPS relay and integrate that relay through a purpose-built package.

## Guarantees

- Credentials and provider endpoints are accepted only through trusted options and Runtime secrets.
- Business input cannot provide API keys, Mailgun domains, API origins, timeout policy, or retries.
- `to`, `cc`, and `bcc` recipients are validated, deduplicated across fields, and omitted from results and errors.
- Direct text/HTML, safe local interpolation, and provider-native templates are distinct formal modes.
- Attachments preserve canonical Base64 bytes in SendGrid JSON and Mailgun multipart requests.
- All redirects are rejected before the target is contacted.
- Every execution performs one delivery POST. Timeout, network, 429, and 5xx outcomes are never replayed by the package.
- One total deadline covers the POST and bounded response reading.
- Provider bodies, message content, subjects, recipient addresses, attachment bytes, credentials, URLs, and arbitrary exception messages are not returned.
- Strict readonly TypeScript overloads associate SendGrid and Mailgun input with their trusted options.

## Basic SendGrid delivery

```js
const { execute } = require('@maitask/email-sender');

const result = await execute({
  provider: 'sendgrid',
  from: { email: 'reports@example.com', name: 'Maitask Reports' },
  to: [{ email: 'owner@example.com', name: 'Workflow Owner' }],
  cc: [{ email: 'operations@example.com' }],
  bcc: [{ email: 'audit@example.com' }],
  replyTo: { email: 'support@example.com', name: 'Support' },
  subject: 'Weekly production report',
  content: {
    text: 'The weekly report is attached.',
    html: '<p>The weekly report is attached.</p>'
  },
  headers: { 'X-Trace-Id': 'trace-1' },
  tags: ['production', 'report'],
  metadata: { workflowId: 'workflow-1' },
  attachments: [{
    filename: 'report.pdf',
    contentType: 'application/pdf',
    bodyBase64: 'JVBERi0xLjQK'
  }]
}, {
  apiKeySecret: 'SENDGRID_API_KEY',
  timeoutMs: 30000,
  maxResponseBytes: 65536
}, {
  secrets: { SENDGRID_API_KEY: 'runtime-managed-secret' },
  executionId: 'execution-1'
});
```

The default SendGrid secret name is `SENDGRID_API_KEY` and the default origin is `https://api.sendgrid.com`.

## Basic Mailgun delivery

```js
const result = await execute({
  provider: 'mailgun',
  from: { email: 'reports@example.com', name: 'Maitask Reports' },
  to: [{ email: 'owner@example.com' }],
  subject: 'Artifact delivery',
  content: {
    text: 'The binary artifact is attached.'
  },
  attachments: [{
    filename: 'artifact.bin',
    contentType: 'application/octet-stream',
    bodyBase64: 'AP+AQQ=='
  }]
}, {
  domain: 'mg.example.com',
  apiKeySecret: 'MAILGUN_API_KEY'
}, {
  secrets: { MAILGUN_API_KEY: 'runtime-managed-secret' }
});
```

The default Mailgun secret name is `MAILGUN_API_KEY` and the default origin is `https://api.mailgun.net`. EU accounts can use trusted `baseUrl: "https://api.eu.mailgun.net"`.

## Recipients and addresses

`from` is required. `to`, `cc`, and `bcc` are arrays of `{ email, name? }`; at least one combined recipient is required. The package accepts validated ASCII local parts and normalized DNS domains. Display names, subjects, reply-to values, custom headers, filenames, and content IDs reject CR, LF, and NUL characters.

The same normalized email address cannot appear more than once across `to`, `cc`, and `bcc`. The combined recipient limit is 1000. Success receipts expose only `recipientCount`, never the address lists.

## Content modes

Exactly one of `content`, `template`, or `providerTemplate` is required.

### Direct content

```js
content: {
  text: 'Plain text message',
  html: '<p>HTML message</p>'
}
```

At least one non-empty representation is required. Direct content requires `subject`. Each representation is limited to 5 MiB of UTF-8 data. The package does not invent fallback text or perform lossy HTML-to-text conversion.

### Local template

```js
subject: 'Hello from Maitask',
template: {
  text: 'Hello {{ user.name }}, executions={{count}}',
  html: '<p>Hello {{user.name}}, note={{note}}</p>',
  variables: {
    user: { name: 'Workflow owner' },
    count: 3,
    note: '<verified>'
  }
}
```

Placeholders use exact `{{ path.to.value }}` syntax. Every placeholder must resolve to a JSON primitive; unresolved paths, object/array substitutions, malformed braces, conditionals, loops, and raw interpolation are rejected. HTML substitutions escape `&`, `<`, `>`, quotes, and apostrophes. Text substitutions preserve their string representation. Local templates require `subject`.

This is interpolation, not an undocumented Handlebars-compatible engine. The legacy built-in `notification`, `alert`, and `report` names were removed because their conditional and loop syntax was never implemented.

### Provider-native template

```js
providerTemplate: {
  id: 'provider-template-id',
  variables: {
    name: 'Maitask',
    metrics: { executions: 42 }
  }
}
```

SendGrid maps this to `template_id` and `dynamic_template_data`. Mailgun maps it to `template` and `X-Mailgun-Variables`. Variables are detached JSON data. `subject` is optional because the provider template may own it.

## Attachments

```js
attachments: [{
  filename: 'chart.png',
  contentType: 'image/png',
  bodyBase64: 'iVBORw0KGgo=',
  disposition: 'inline',
  contentId: 'chart.png'
}]
```

- `bodyBase64` must be canonical RFC 4648 Base64.
- Default disposition is `attachment`.
- Inline attachments require `contentId`; ordinary attachments cannot set one.
- Mailgun addresses inline parts by filename, so Mailgun inline `contentId` must equal `filename`.
- Maximum 20 attachments, 10 MiB decoded per attachment, and 20 MiB decoded in total.
- Provider request encoding is bounded at 30 MiB.

SendGrid receives documented JSON attachment fields. Mailgun receives exact multipart bytes through Runtime `bodyBase64`, avoiding UTF-8 corruption.

## Message headers, tags, and metadata

`headers` accepts only unique `X-*` message headers with string values. `X-SMTPAPI` and `X-Mailgun-Variables` are provider-control fields and are reserved. Transport authorization, host, content type, and other provider headers cannot be supplied by business input.

SendGrid supports up to 10 categories; Mailgun supports up to 3 tags. The common `tags` field applies the provider-specific limit.

`metadata` is a bounded string record. It maps to SendGrid `custom_args` and Mailgun `v:*` variables, with a maximum of 50 entries and 10 KiB combined key/value UTF-8 bytes.

## Trusted options

| Option | SendGrid | Mailgun | Contract |
| --- | --- | --- | --- |
| `baseUrl` | `https://api.sendgrid.com` | `https://api.mailgun.net` | Exact provider origin without path, query, fragment, or credentials. |
| `domain` | prohibited | required | Valid Mailgun sending domain. |
| `apiKeySecret` | `SENDGRID_API_KEY` | `MAILGUN_API_KEY` | Exact secret name. |
| `timeoutMs` | `30000` | `30000` | One total deadline from 10 through 120000 ms. |
| `maxResponseBytes` | `65536` | `65536` | Provider response ceiling from 1 byte through 1 MiB. |
| `allowInsecureHttp` | `false` | `false` | Allows HTTP only for literal private/loopback fixture endpoints. |
| `secrets` | optional | optional | Trusted string secret record; takes precedence over `context.secrets`. |

Options are strict and cannot contain retry settings, SMTP configuration, literal `apiKey`, or business message data.

## Delivery semantics

The provider request always uses POST with manual redirect handling. Every 301, 302, 303, 307, or 308 is rejected; the target receives no request.

The package never retries a delivery POST. A timeout or lost connection can occur after the provider accepted the message, so automatic replay could create duplicate email. Failures expose `retriable` as operational guidance only. A workflow that chooses to retry must apply its own delivery ledger, provider message search, or business idempotency policy.

## Success result

```json
{
  "success": true,
  "data": {
    "items": [{
      "index": 0,
      "id": "provider-message-id",
      "data": {
        "provider": "sendgrid",
        "messageId": "provider-message-id",
        "status": 202,
        "recipientCount": 3,
        "hasText": true,
        "hasHtml": true,
        "attachmentCount": 1,
        "templateMode": "none"
      }
    }],
    "summary": {
      "total": 1,
      "success_count": 1,
      "failure_count": 0
    }
  },
  "error": null,
  "metadata": {
    "contractVersion": "2026-07-11",
    "package": "@maitask/email-sender",
    "version": "1.0.0",
    "provider": "sendgrid",
    "executionId": "execution-1",
    "status": 202,
    "attempts": 1,
    "executedAt": "2026-07-11T00:00:00.000Z",
    "executionMs": 24
  },
  "citations": []
}
```

SendGrid message IDs come only from `X-Message-Id`. Mailgun message IDs come only from the controlled `id` field in a bounded successful JSON response. Other provider response data is discarded.

## Failure codes

| Code | Meaning |
| --- | --- |
| `EMAIL_VALIDATION` | Message, options, template, attachment, address, header, tag, metadata, or snapshot validation failed. |
| `EMAIL_SECRET_UNAVAILABLE` | The named provider API secret was missing or empty. |
| `EMAIL_POLICY` | Provider endpoint transport policy rejected the configured origin. |
| `EMAIL_TIMEOUT` | The one total request/response deadline expired. Delivery status may be uncertain. |
| `EMAIL_RESPONSE_TOO_LARGE` | Provider response bytes exceeded the configured ceiling. |
| `EMAIL_REDIRECT` | The provider attempted a redirect. |
| `EMAIL_PROVIDER` | The provider returned a non-2xx status. Only numeric status and retriable classification are exposed. |
| `EMAIL_UPSTREAM` | Transport or successful-response validation failed without exposing arbitrary details. |

## Version 1 migration

- `api_key`, `domain`, and `smtp_config` are removed from input. Provider policy and credentials belong in trusted options and secrets.
- `smtp` is removed because it is not executable in managed Runtime.
- `template_data` and built-in template names are replaced by formal `template` or `providerTemplate` objects.
- Snake_case output and option aliases are removed.
- Empty content no longer generates an implicit Maitask message.
- Recipient strings become explicit address objects.
- Provider responses and error bodies are no longer returned.
- Retry examples are removed; the package intentionally sends each delivery once.

No compatibility aliases remain because they would preserve ambiguous credential precedence and unverified delivery behavior.

## Deterministic verification

Mandatory tests use controlled loopback fixtures and Runtime operation mocks. They do not call live SendGrid or Mailgun services. Live provider smoke checks are optional diagnostics and require separately managed test accounts and cleanup policy.
