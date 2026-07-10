# AI Provider Deterministic Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenAI, Claude, Gemini, DeepSeek, and Ollama packages verifiable without live third-party services while preserving their production defaults.

**Architecture:** Extract the existing local HTTP fixture server into a reusable helper, add provider-protocol tests that exercise real HTTP requests and streaming bodies, and introduce one canonical `baseUrl` option plus a provider-specific Runtime environment fallback. Production URLs remain defaults; mandatory tests always use loopback fixture endpoints.

**Tech Stack:** Node.js 18+, built-in `fetch`, `node:http`, `node:test`, CommonJS package modules, SSE and NDJSON response streams.

---

### Task 1: Extract a reusable HTTP fixture server

**Files:**
- Create: `tests/helpers/http-fixture.js`
- Modify: `tests/external-fixtures.test.js`

- [ ] **Step 1: Create the reusable helper**

```js
const http = require('node:http');

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function createFixtureServer(handler) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const body = await readRequestBody(request);
      const result = await handler(url, request, body);

      if (!result) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }

      const status = result.status || 200;
      const headers = result.headers || { 'content-type': 'application/json; charset=utf-8' };
      const responseBody =
        typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      response.writeHead(status, headers);
      response.end(responseBody);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(closeResolve => server.close(closeResolve))
      });
    });
  });
}

module.exports = { createFixtureServer };
```

- [ ] **Step 2: Replace the private helper in the existing fixture suite**

Remove `require('node:http')` and the local `createFixtureServer` implementation
from `tests/external-fixtures.test.js`, then add:

```js
const { createFixtureServer } = require('./helpers/http-fixture');
```

- [ ] **Step 3: Run the existing external fixture suite**

Run: `npm run test:external-fixtures`

Expected: all 10 existing external fixture tests pass.

- [ ] **Step 4: Commit the fixture helper refactor**

```bash
git add tests/helpers/http-fixture.js tests/external-fixtures.test.js
git commit -m "Share the package HTTP fixture server"
```

### Task 2: Add failing controlled-endpoint tests for AI providers

**Files:**
- Create: `tests/ai-provider-fixtures.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add provider protocol tests**

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeClaude } = require('../claude');
const { execute: executeDeepSeek } = require('../deepseek');
const { execute: executeGemini } = require('../gemini');
const { execute: executeOllama } = require('../ollama');
const { execute: executeOpenAI } = require('../openai');
const { createFixtureServer } = require('./helpers/http-fixture');

test('openai uses a controlled chat completions endpoint', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/openai/v1/chat/completions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer fixture-openai');
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'gpt-fixture');
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello openai' }]);
    assert.equal(payload.max_tokens, 64);
    assert.equal(payload.stream, false);
    return {
      body: {
        model: 'gpt-fixture',
        choices: [{ message: { content: 'openai fixture response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeOpenAI(
    { model: 'gpt-fixture', text: 'hello openai', maxTokens: 64 },
    { apiKey: 'fixture-openai', baseUrl: `${server.url}/openai/v1`, retries: 0 }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.content, 'openai fixture response');
  assert.deepEqual(result.data.usage, {
    promptTokens: 3,
    completionTokens: 4,
    totalTokens: 7
  });
});

test('claude uses the Runtime base URL environment fallback', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/anthropic/v1/messages');
    assert.equal(request.headers['x-api-key'], 'fixture-anthropic');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'claude-fixture');
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello claude' }]);
    assert.equal(payload.max_tokens, 48);
    return {
      body: {
        model: 'claude-fixture',
        content: [{ type: 'text', text: 'claude fixture response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 6 }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeClaude(
    { model: 'claude-fixture', text: 'hello claude', maxTokens: 48 },
    { apiKey: 'fixture-anthropic', retries: 0 },
    { env: { ANTHROPIC_API_BASE_URL: `${server.url}/anthropic/v1` } }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.content, 'claude fixture response');
  assert.equal(result.data.usage.totalTokens, 11);
});

test('gemini aggregates a controlled streaming response', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/google/v1beta/models/gemini-fixture:streamGenerateContent');
    assert.equal(url.searchParams.get('alt'), 'sse');
    assert.equal(request.headers['x-goog-api-key'], 'fixture-google');
    const payload = JSON.parse(body);
    assert.deepEqual(payload.contents, [{ role: 'user', parts: [{ text: 'hello gemini' }] }]);
    return {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: [
        'data: {"candidates":[{"content":{"parts":[{"text":"gemini "}]}}]}',
        '',
        'data: {"candidates":[{"content":{"parts":[{"text":"fixture"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}',
        '',
        'data: [DONE]',
        ''
      ].join('\n')
    };
  });
  t.after(() => server.close());

  const result = await executeGemini(
    { model: 'gemini-fixture', text: 'hello gemini', stream: true },
    { apiKey: 'fixture-google', baseUrl: `${server.url}/google/v1beta/models`, retries: 0 }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.content, 'gemini fixture');
  assert.equal(result.data.finishReason, 'STOP');
  assert.deepEqual(result.data.chunks, ['gemini ', 'fixture']);
  assert.equal(result.data.usage.totalTokens, 5);
});

test('deepseek returns a structured retryable upstream failure', async t => {
  let attempts = 0;
  const server = await createFixtureServer(url => {
    attempts += 1;
    assert.equal(url.pathname, '/deepseek/chat/completions');
    return {
      status: 503,
      body: { error: { message: 'deepseek fixture unavailable' } }
    };
  });
  t.after(() => server.close());

  const result = await executeDeepSeek(
    { model: 'deepseek-chat', text: 'hello deepseek' },
    { apiKey: 'fixture-deepseek', baseUrl: `${server.url}/deepseek`, retries: 0 }
  );

  assert.equal(attempts, 1);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'DEEPSEEK_API_ERROR');
  assert.equal(result.error.status, 503);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.message, 'deepseek fixture unavailable');
});

test('ollama aggregates native NDJSON from a controlled endpoint', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/api/chat');
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'ollama-fixture');
    assert.equal(payload.stream, true);
    return {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      body: [
        JSON.stringify({ model: 'ollama-fixture', message: { content: 'ollama ' }, done: false }),
        JSON.stringify({
          model: 'ollama-fixture',
          message: { content: 'fixture' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 5
        }),
        ''
      ].join('\n')
    };
  });
  t.after(() => server.close());

  const result = await executeOllama(
    { model: 'ollama-fixture', text: 'hello ollama', stream: true },
    { baseUrl: server.url, retries: 0 }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.content, 'ollama fixture');
  assert.equal(result.data.finishReason, 'stop');
  assert.equal(result.data.usage.totalTokens, 9);
});
```

- [ ] **Step 2: Add the focused test script**

Add to `package.json`:

```json
"test:ai-providers": "node --test tests/ai-provider-fixtures.test.js"
```

- [ ] **Step 3: Run the tests and verify the correct RED state**

Run: `npm run test:ai-providers`

Expected: OpenAI, Claude, Gemini, and DeepSeek fail because their requests do
not reach the loopback fixture. Ollama passes because it already honors
`options.baseUrl`.

- [ ] **Step 4: Commit the failing regression tests**

```bash
git add package.json tests/ai-provider-fixtures.test.js
git commit -m "Add deterministic AI provider protocol regressions"
```

### Task 3: Implement the canonical provider base URL contract

**Files:**
- Modify: `openai/index.js`
- Modify: `claude/index.js`
- Modify: `gemini/index.js`
- Modify: `deepseek/index.js`

- [ ] **Step 1: Add canonical default base URLs**

Use these constants:

```js
const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_API_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_API_BASE_URL = 'https://api.deepseek.com';
```

Each constant belongs only in its corresponding provider module.

- [ ] **Step 2: Normalize and validate base URLs**

Add this helper to each provider module:

```js
function normalizeBaseUrl(value, fallback) {
  const candidate = asNonEmptyString(value) || fallback;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl must be an absolute HTTP or HTTPS URL');
  }

  return parsed.toString().replace(/\/$/, '');
}
```

- [ ] **Step 3: Add provider configuration precedence**

Set `cfg.baseUrl` from the canonical option, Runtime environment, then default:

```js
baseUrl: normalizeBaseUrl(
  options.baseUrl || context?.env?.OPENAI_API_BASE_URL,
  DEFAULT_API_BASE_URL
)
```

Use `ANTHROPIC_API_BASE_URL`, `GEMINI_API_BASE_URL`, and
`DEEPSEEK_API_BASE_URL` in the corresponding modules.

- [ ] **Step 4: Build request endpoints from `cfg.baseUrl`**

Use these endpoint expressions:

```js
`${cfg.baseUrl}/chat/completions`
`${cfg.baseUrl}/messages`
`${cfg.baseUrl}/${cfg.model}:streamGenerateContent?alt=sse`
`${cfg.baseUrl}/${cfg.model}:generateContent`
`${cfg.baseUrl}/chat/completions`
```

- [ ] **Step 5: Run focused provider tests**

Run: `npm run test:ai-providers`

Expected: all five provider tests pass.

- [ ] **Step 6: Commit the implementation**

```bash
git add openai/index.js claude/index.js gemini/index.js deepseek/index.js
git commit -m "Support controlled AI provider endpoints"
```

### Task 4: Formalize types and documentation

**Files:**
- Modify: `openai/index.d.ts`
- Modify: `claude/index.d.ts`
- Modify: `gemini/index.d.ts`
- Modify: `deepseek/index.d.ts`
- Modify: `openai/README.md`
- Modify: `claude/README.md`
- Modify: `gemini/README.md`
- Modify: `deepseek/README.md`
- Modify: `ollama/README.md`

- [ ] **Step 1: Add the formal option fields**

Add these fields to each provider `ExecuteOptions` interface:

```ts
baseUrl?: string;
timeoutMs?: number;
retries?: number;
```

Define `ExecuteContext` with typed `secrets` and `env` objects containing the
provider-specific API key and base URL variable. Do not add new snake_case or
uppercase option aliases.

- [ ] **Step 2: Document configuration precedence**

Each README must state:

1. `options.baseUrl` overrides the provider endpoint for compatible gateways
   and controlled regression.
2. The provider-specific `context.env.*_API_BASE_URL` is the Runtime fallback.
3. The official provider URL remains the production default.
4. Mandatory repository tests use loopback fixtures; live provider smoke tests
   require separate credentials and are optional.

The Ollama README must state that its existing `options.baseUrl` is exercised by
the same deterministic provider matrix.

- [ ] **Step 3: Run metadata, provider, and archive tests**

Run:

```bash
npm run test:metadata
npm run test:ai-providers
npm run test:archives
```

Expected: all commands pass.

- [ ] **Step 4: Commit the formal contract documentation**

```bash
git add openai claude gemini deepseek ollama/README.md
git commit -m "Document AI provider endpoint configuration"
```

### Task 5: Run the complete Packages quality gate

**Files:**
- No additional files unless a listed verification exposes a defect.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: catalog, archive, existing external fixtures, and AI provider fixtures
all pass with no skipped or todo tests.

- [ ] **Step 2: Verify repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no unintended files.

- [ ] **Step 3: Commit this implementation plan**

```bash
git add docs/superpowers/plans/2026-07-10-ai-provider-fixtures.md
git commit -m "Document deterministic AI provider regression"
```
