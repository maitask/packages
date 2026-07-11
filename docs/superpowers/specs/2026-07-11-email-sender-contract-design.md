# Email Sender Contract Design

## Goal

Replace the permissive email wrapper with a deterministic delivery client whose recipients, credentials, content, templates, attachments, provider requests, and failures remain inside explicit production boundaries.

## Provider scope

The managed package supports SendGrid v3 and Mailgun v3 over Runtime HTTP. The legacy SMTP branch is removed because managed Maitask Runtime deliberately exposes no raw TCP or Node `net`/`tls` modules; retaining it would document a capability that cannot execute on production workers. SMTP delivery requires a separately managed HTTPS relay and is not emulated inside this package.

`input.provider` is explicitly `sendgrid` or `mailgun`. Trusted `options` contains the provider API origin, Mailgun domain, secret name, total timeout, maximum response bytes, optional insecure loopback fixture permission, and secret values. Credentials are resolved by exact name from `options.secrets` and then `context.secrets`; business input cannot supply credentials or provider endpoints.

## Message contract

Messages support a validated sender, `to`, `cc`, and `bcc` recipients, optional reply-to address, subject, direct text/HTML content, local interpolated text/HTML templates, provider-native templates, custom `X-*` message headers, tags, string metadata, and exact Base64 attachments. Recipient addresses are unique across all recipient fields and are never returned in results or errors.

Exactly one content mode is present:

- `content` contains non-empty `text`, `html`, or both;
- `template` contains non-empty text/HTML sources and a detached JSON variable record; every `{{ path }}` placeholder must resolve and HTML substitutions are escaped;
- `providerTemplate` contains an exact provider template identifier and detached JSON variables.

Direct and local-template messages require a subject. Provider-native templates may own the subject. Empty fallback text, implicit templates, unknown template names, raw variable injection, conditionals, loops, and undocumented template syntax are not accepted.

Attachments contain `filename`, `contentType`, canonical `bodyBase64`, optional `disposition`, and optional `contentId` for inline content. The package bounds file count, each decoded file, and total decoded attachment bytes before network contact. SendGrid receives its documented JSON attachment representation. Mailgun receives an exact multipart body through Runtime `bodyBase64`.

## Transport and delivery semantics

Provider API origins must be HTTPS without credentials, paths, queries, or fragments. Trusted `allowInsecureHttp` permits only literal loopback/private fixture addresses. SendGrid uses `/v3/mail/send`; Mailgun uses `/v3/{domain}/messages` with the domain path segment encoded.

Every provider POST uses `redirect: "manual"`. All redirects are rejected before their target is contacted. Each execution performs exactly one delivery POST: network failures, timeouts, 429 responses, and 5xx responses are reported as retriable but never replayed. One total deadline covers request submission and bounded response reading.

Provider credentials are written after validation and cannot be overridden. SendGrid bearer credentials are confined to its exact configured origin. Mailgun Basic credentials are confined to its exact configured origin. The package never returns request URLs, credentials, message content, subject, recipient addresses, attachment bytes, raw provider bodies, or arbitrary exception messages.

## Data and error boundaries

Input, options, context, recipients, content, template variables, attachments, headers, tags, metadata, and secrets are synchronously copied from own data descriptors. Accessors, symbols, custom prototypes, cycles, sparse arrays, unknown fields, aliases, non-JSON values, duplicate addresses, header injection, and unsupported provider fields fail before network access.

Successful responses are mapped into a controlled delivery receipt containing provider, provider message identifier, numeric status, recipient count, content modes, attachment count, and template mode. Failures use stable `EMAIL_VALIDATION`, `EMAIL_SECRET_UNAVAILABLE`, `EMAIL_POLICY`, `EMAIL_TIMEOUT`, `EMAIL_RESPONSE_TOO_LARGE`, `EMAIL_REDIRECT`, `EMAIL_PROVIDER`, and `EMAIL_UPSTREAM` codes.

## Verification

Deterministic loopback fixtures cover complete SendGrid JSON and Mailgun multipart requests, all recipient fields, direct/local/provider templates, HTML escaping, exact attachment bytes, Runtime Base64 transport, credential sources, strict snapshots, aliases, duplicates, injected headers, invalid addresses, provider redirects with zero target requests, one-attempt 429/5xx/network behavior, total timeout, response limits, provider response mapping, secret-safe errors, and readonly provider-specific TypeScript overloads. Live provider calls are optional diagnostics only.
