const assert = require('node:assert/strict');
const test = require('node:test');

const { execute } = require('../document-intelligence');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;

test.before(() => {
  global.fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error(`Document intelligence fixture attempted external access: ${target.origin}`);
    }
    return nativeFetch(url, init);
  };
});

test.after(() => {
  global.fetch = nativeFetch;
});

test('document intelligence fails closed without an API key', async () => {
  const result = await execute({ text: 'Example document' }, { task: 'summarize' });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'DOCUMENT_AI_KEY_REQUIRED');
});

test('document intelligence summarizes with sourced published copy', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/v1/chat/completions');
    const payload = JSON.parse(body);
    assert.equal(payload.response_format.type, 'json_object');
    return {
      body: {
        model: 'gpt-fixture',
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Runtime isolation',
                body: 'Workers execute packages as native processes.',
                sources: [{ title: 'Runtime', url: 'https://maitask.com/docs/runtime' }]
              })
            }
          }
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 }
      }
    };
  });
  t.after(() => server.close());

  const result = await execute(
    {
      documents: [
        {
          title: 'Runtime isolation',
          text: 'Managed Runtime workers execute packages as native processes.',
          url: 'https://maitask.com/docs/runtime'
        }
      ]
    },
    {
      task: 'summarize',
      language: 'en',
      ai: { apiKey: 'fixture-key', baseUrl: `${server.url}/v1`, model: 'gpt-fixture' }
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.deliverable.title, 'Runtime isolation');
  assert.match(result.metadata.channel_message, /Sources/);
  assert.equal(result.metadata.usage.prompt_tokens, 20);
  assert.equal(result.citations.length, 1);
});

test('document intelligence classification requires labels', async () => {
  const result = await execute(
    { text: 'The worker timed out.' },
    { task: 'classify', ai: { apiKey: 'fixture-key' } }
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'DOCUMENT_LABELS_REQUIRED');
});
