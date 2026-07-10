const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeClaude } = require('../claude');
const { execute: executeDeepSeek } = require('../deepseek');
const { execute: executeGemini } = require('../gemini');
const { execute: executeOllama } = require('../ollama');
const { execute: executeOpenAI } = require('../openai');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;

test.before(() => {
  global.fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error(`AI provider fixture attempted external access: ${target.origin}`);
    }
    return nativeFetch(url, init);
  };
});

test.after(() => {
  global.fetch = nativeFetch;
});

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
        JSON.stringify({
          model: 'ollama-fixture',
          message: { content: 'ollama ' },
          done: false
        }),
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
