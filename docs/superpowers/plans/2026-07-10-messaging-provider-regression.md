# Messaging Provider Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Telegram, Slack, and Kafka publishing packages deterministic protocol coverage and one formal camelCase configuration contract without live external services.

**Architecture:** Use the shared loopback HTTP fixture server and block non-loopback fetches in the mandatory suite. Telegram gains a controlled API base URL; Slack keeps caller-provided webhook routing but formalizes its public option names; Kafka retains its explicit REST proxy contract. Provider-specific transport code stays inside each package.

**Tech Stack:** Node.js 18+, built-in `fetch`, `node:test`, local HTTP fixtures, Telegram Bot API, Slack Incoming Webhooks, Confluent-compatible Kafka REST Proxy.

---

### Task 1: Add messaging protocol regression tests

**Files:**
- Create: `tests/messaging-provider-fixtures.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write loopback-only provider tests**

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeKafka } = require('../kafka-publisher');
const { execute: executeSlack } = require('../slack-notifier');
const { execute: executeTelegram } = require('../telegram-bot');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;

test.before(() => {
  global.fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error(`Messaging provider fixture attempted external access: ${target.origin}`);
    }
    return nativeFetch(url, init);
  };
});

test.after(() => {
  global.fetch = nativeFetch;
});

test('telegram sends text through a controlled Bot API endpoint', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-1001',
      text: 'deployment complete',
      parse_mode: 'HTML',
      disable_notification: true
    });
    return {
      body: {
        ok: true,
        result: { message_id: 42, chat: { id: -1001 }, text: 'deployment complete' }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { text: 'deployment complete' },
    {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-1001',
      parseMode: 'HTML',
      disableNotification: true
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.message_id, 42);
  assert.equal(result.chat_id, -1001);
  assert.equal(result.metadata.method, 'sendMessage');
});

test('telegram returns a structured API failure through the Runtime endpoint fallback', async t => {
  const server = await createFixtureServer(url => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    return { status: 400, body: { ok: false, description: 'chat not found' } };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { text: 'delivery failure' },
    { botToken: 'fixture-token', chatId: 'missing-chat' },
    { env: { TELEGRAM_API_BASE_URL: `${server.url}/telegram` } }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.match(result.error.message, /400.*chat not found/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('slack sends the formal webhook payload and masks the result URL', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/services/T000/B000/fixture-secret');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      text: 'release complete',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Success*' } }],
      thread_ts: '1700000000.000001',
      username: 'Release Bot',
      icon_emoji: ':rocket:',
      link_names: false,
      mrkdwn: true
    });
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  t.after(() => server.close());

  const result = await executeSlack(
    {
      text: 'release complete',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Success*' } }]
    },
    {
      webhookUrl: `${server.url}/services/T000/B000/fixture-secret`,
      threadTs: '1700000000.000001',
      username: 'Release Bot',
      iconEmoji: ':rocket:',
      linkNames: false,
      mrkdwn: true
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.webhook, `${server.url}/services/T***/B***/***`);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});

test('slack returns a secret-safe structured webhook failure', async t => {
  const server = await createFixtureServer(() => ({
    status: 429,
    headers: { 'content-type': 'text/plain' },
    body: 'rate_limited'
  }));
  t.after(() => server.close());

  const result = await executeSlack(
    { text: 'retry later' },
    { webhookUrl: `${server.url}/services/T111/B111/fixture-secret` }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.match(result.error.message, /429.*rate_limited/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});

test('kafka publishes records through a controlled REST proxy', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/topics/production-events');
    assert.equal(request.headers.authorization, 'Bearer fixture-kafka');
    assert.equal(request.headers['content-type'], 'application/vnd.kafka.json.v2+json');
    assert.deepEqual(JSON.parse(body), {
      records: [
        { key: 'release', value: 'deployed' },
        { key: 'release', value: '{"version":"1.2.3"}' }
      ]
    });
    return {
      body: {
        offsets: [
          { partition: 0, offset: 101 },
          { partition: 0, offset: 102 }
        ]
      }
    };
  });
  t.after(() => server.close());

  const result = await executeKafka({
    proxyUrl: server.url,
    topic: 'production-events',
    key: 'release',
    messages: ['deployed', { version: '1.2.3' }],
    headers: { Authorization: 'Bearer fixture-kafka' }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.count, 2);
  assert.deepEqual(result.data.offsets, [
    { partition: 0, offset: 101 },
    { partition: 0, offset: 102 }
  ]);
});

test('kafka returns a structured REST proxy failure', async t => {
  const server = await createFixtureServer(() => ({
    status: 503,
    body: { error: { message: 'broker unavailable' } }
  }));
  t.after(() => server.close());

  const result = await executeKafka({
    proxyUrl: server.url,
    topic: 'production-events',
    messages: ['event']
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
  assert.equal(result.error.type, 'KafkaPublisherError');
  assert.equal(result.error.message, 'broker unavailable');
});
```

- [ ] **Step 2: Add the focused script**

Add to `package.json`:

```json
"test:messaging-providers": "node --test tests/messaging-provider-fixtures.test.js"
```

- [ ] **Step 3: Verify the RED state**

Run: `npm run test:messaging-providers`

Expected:

- both Telegram tests fail because the implementation uses a hard-coded API
  origin and snake_case configuration;
- both Slack tests fail because `webhookUrl`, `threadTs`, `iconEmoji`, and
  `linkNames` are not the formal public names yet;
- Kafka success and failure tests pass through the existing proxy URL contract.

- [ ] **Step 4: Commit the failing tests**

```bash
git add package.json tests/messaging-provider-fixtures.test.js
git commit -m "Add deterministic messaging provider regressions"
```

### Task 2: Formalize Telegram configuration and controlled routing

**Files:**
- Modify: `telegram-bot/index.js`
- Test: `tests/messaging-provider-fixtures.test.js`

- [ ] **Step 1: Replace the configuration object with formal fields**

`buildConfig` must return:

```js
{
  baseUrl: normalizeBaseUrl(
    options.baseUrl || context?.env?.TELEGRAM_API_BASE_URL,
    'https://api.telegram.org'
  ),
  botToken: options.botToken || context?.secrets?.TELEGRAM_BOT_TOKEN,
  chatId: options.chatId,
  text: options.text,
  messageType: options.messageType || 'text',
  parseMode: options.parseMode || 'Markdown',
  replyToMessageId: options.replyToMessageId,
  disableNotification: options.disableNotification === true,
  disableWebPagePreview: options.disableWebPagePreview,
  replyMarkup: options.replyMarkup,
  fileUrl: options.fileUrl,
  caption: options.caption,
  timeoutMs: readTimeout(options.timeoutMs)
}
```

Do not retain snake_case option aliases after this formal contract is
introduced.

- [ ] **Step 2: Build all three Telegram methods from the formal config**

Use:

```js
`${config.baseUrl}/bot${config.botToken}/sendMessage`
`${config.baseUrl}/bot${config.botToken}/sendPhoto`
`${config.baseUrl}/bot${config.botToken}/sendDocument`
```

Translate formal option names to Telegram's required snake_case JSON fields at
the HTTP boundary only.

- [ ] **Step 3: Add URL and timeout validation helpers**

`normalizeBaseUrl` must accept only absolute HTTP/HTTPS URLs and strip the final
slash. `readTimeout` must default to 30000 milliseconds and clamp positive
values to at most 120000 milliseconds.

- [ ] **Step 4: Keep all failures structured and secret-safe**

Validation, JSON parsing, HTTP failures, and timeouts must return
`TELEGRAM_ERROR`. Error messages may contain status and Telegram description,
but must never contain `botToken` or the full request URL.

- [ ] **Step 5: Run the focused suite**

Run: `npm run test:messaging-providers`

Expected: Telegram and Kafka tests pass; Slack tests remain red.

- [ ] **Step 6: Commit Telegram implementation**

```bash
git add telegram-bot/index.js
git commit -m "Formalize Telegram Bot API delivery"
```

### Task 3: Formalize Slack webhook delivery

**Files:**
- Modify: `slack-notifier/index.js`
- Test: `tests/messaging-provider-fixtures.test.js`

- [ ] **Step 1: Adopt formal camelCase input and option names**

The merged input/options contract must use:

```js
webhookUrl
text
blocks
attachments
threadTs
channel
username
iconEmoji
iconUrl
linkNames
mrkdwn
```

`context.secrets.SLACK_WEBHOOK_URL` remains the secret fallback. Do not retain
snake_case public aliases.

- [ ] **Step 2: Translate only at the Slack boundary**

The outbound Slack payload must contain `thread_ts`, `icon_emoji`, `icon_url`,
and `link_names` because those are Slack protocol fields. Internal configuration
and TypeScript types remain camelCase.

- [ ] **Step 3: Preserve safe error metadata**

Both success and failure results must call `maskWebhookUrl(config.webhookUrl)`.
The raw webhook URL and final secret path components must not appear in the
result or error message.

- [ ] **Step 4: Run the focused suite**

Run: `npm run test:messaging-providers`

Expected: all six tests pass.

- [ ] **Step 5: Commit Slack implementation**

```bash
git add slack-notifier/index.js
git commit -m "Formalize Slack webhook delivery"
```

### Task 4: Add explicit TypeScript contracts and production documentation

**Files:**
- Modify: `telegram-bot/index.d.ts`
- Modify: `telegram-bot/README.md`
- Modify: `telegram-bot/example.json`
- Modify: `slack-notifier/index.d.ts`
- Modify: `slack-notifier/README.md`
- Modify: `slack-notifier/example.json`
- Modify: `kafka-publisher/index.d.ts`
- Modify: `kafka-publisher/README.md`
- Modify: `kafka-publisher/example.json`

- [ ] **Step 1: Define Telegram types**

Add explicit `TelegramInput`, `TelegramOptions`, `TelegramContext`, success,
error, and result interfaces. `TelegramOptions` must expose exactly the formal
fields from Task 2. `TelegramContext` must type `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_API_BASE_URL`.

- [ ] **Step 2: Define Slack types**

Add explicit Block Kit/attachment-compatible input types without using `any` for
the top-level package contract. `SlackOptions` must expose the formal fields from
Task 3, and `SlackContext` must type `SLACK_WEBHOOK_URL`.

- [ ] **Step 3: Define Kafka types**

Add explicit Kafka input/options/result types for `proxyUrl`, `topic`,
`messages`, optional key, headers, timeout, and returned partition/offset data.

- [ ] **Step 4: Reconcile documentation and examples**

All READMEs and examples must use formal camelCase package options. Document the
provider protocol translation separately so users do not copy Telegram or Slack
wire-level snake_case fields into Maitask configuration. State that mandatory
tests use loopback fixtures and live provider tests are optional diagnostics.

- [ ] **Step 5: Run metadata and archive checks**

Run:

```bash
npm run test:metadata
npm run test:messaging-providers
npm run test:archives
```

Expected: all commands pass.

- [ ] **Step 6: Commit types and documentation**

```bash
git add telegram-bot slack-notifier kafka-publisher
git commit -m "Document messaging provider contracts"
```

### Task 5: Complete the Packages gate

**Files:**
- No additional files unless a listed verification exposes a defect.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all catalog, archive, external fixture, AI provider, and messaging
provider tests pass with no skipped or todo tests.

- [ ] **Step 2: Verify repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no unintended files.

- [ ] **Step 3: Commit this plan**

```bash
git add docs/superpowers/plans/2026-07-10-messaging-provider-regression.md
git commit -m "Document messaging provider regression"
```
