const assert = require('node:assert/strict');
const test = require('node:test');

const { execute } = require('../workflow-composer');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;
const catalog = [
  {
    name: '@maitask/web-search',
    version: '0.1.2',
    description: 'Search the web',
    category: 'Web & API Integration',
    input_fields: ['query']
  },
  {
    name: '@maitask/document-intelligence',
    version: '1.0.0',
    description: 'Summarize documents',
    category: 'AI & Cognitive Services',
    input_fields: ['text']
  }
];

test.before(() => {
  global.fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error(`Workflow composer fixture attempted external access: ${target.origin}`);
    }
    return nativeFetch(url, init);
  };
});

test.after(() => {
  global.fetch = nativeFetch;
});

test('workflow composer fails closed without a catalog', async () => {
  const result = await execute(
    { description: 'Search and summarize' },
    { apiKey: 'fixture-key' }
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WORKFLOW_CATALOG_REQUIRED');
});

test('workflow composer rejects packages outside the catalog', async t => {
  const server = await createFixtureServer(() => ({
    body: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: 'Invalid',
              description: 'Uses an unknown package',
              nodes: [
                { id: 'trigger', type: 'trigger-manual', data: { label: 'Start' } },
                {
                  id: 'package',
                  type: 'package',
                  data: { label: 'Unknown', package_name: '@maitask/does-not-exist' }
                },
                { id: 'done', type: 'completion', data: { label: 'Done' } }
              ],
              edges: [
                { id: 'e1', source: 'trigger', target: 'package' },
                { id: 'e2', source: 'package', target: 'done' }
              ]
            })
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }
  }));
  t.after(() => server.close());

  const result = await execute(
    { description: 'Search and summarize', language: 'en', catalog },
    { apiKey: 'fixture-key', baseUrl: `${server.url}/v1` }
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WORKFLOW_DRAFT_INVALID');
});

test('workflow composer returns a reviewable graph from catalog packages', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/v1/chat/completions');
    const payload = JSON.parse(body);
    assert.equal(payload.response_format.type, 'json_object');
    return {
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: 'Research briefing',
                description: 'Search, summarize, and send.',
                notes: 'Select an adapter before publishing.',
                warnings: [],
                nodes: [
                  { id: 'trigger', type: 'trigger-manual', position: { x: 80, y: 120 }, data: { label: 'Start' } },
                  {
                    id: 'search',
                    type: 'package',
                    position: { x: 360, y: 120 },
                    data: { label: 'Search', package_name: '@maitask/web-search', package_version: '0.1.2' }
                  },
                  {
                    id: 'write',
                    type: 'package',
                    position: { x: 640, y: 120 },
                    data: { label: 'Write', package_name: '@maitask/document-intelligence', package_version: '1.0.0' }
                  },
                  { id: 'adapter', type: 'adapter', position: { x: 920, y: 120 }, data: { label: 'Send' } },
                  { id: 'done', type: 'completion', position: { x: 1200, y: 120 }, data: { label: 'Done' } }
                ],
                edges: [
                  { id: 'e1', source: 'trigger', target: 'search' },
                  { id: 'e2', source: 'search', target: 'write' },
                  { id: 'e3', source: 'write', target: 'adapter' },
                  { id: 'e4', source: 'adapter', target: 'done' }
                ]
              })
            }
          }
        ],
        usage: { prompt_tokens: 40, completion_tokens: 80, total_tokens: 120 }
      }
    };
  });
  t.after(() => server.close());

  const result = await execute(
    { description: 'Search recent sources and send a sourced briefing', language: 'en', catalog },
    { apiKey: 'fixture-key', baseUrl: `${server.url}/v1`, model: 'gpt-fixture' }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.name, 'Research briefing');
  assert.equal(result.data.nodes.length, 5);
  assert.equal(result.data.edges.length, 4);
  assert.equal(result.metadata.usage.prompt_tokens, 40);
  assert.ok(result.data.warnings.some(warning => /adapter/i.test(warning)));
});
