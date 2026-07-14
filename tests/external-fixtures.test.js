const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeGraphql } = require('../graphql-client');
const { execute: executeHackerNews } = require('../hackernews-crawler');
const { execute: executeIntelligenceBriefing } = require('../intelligence-briefing');
const { execute: executeWebScraper } = require('../web-scraper');
const { execute: executeWebSearch } = require('../web-search');
const { createFixtureServer } = require('./helpers/http-fixture');

test('hackernews-crawler crawls stories and comments from a fixture API', async t => {
  const server = await createFixtureServer(url => {
    const routes = {
      '/v0/topstories.json': [1001, 1002],
      '/v0/item/1001.json': {
        id: 1001,
        type: 'story',
        title: 'Maitask release checklist',
        by: 'maintainer',
        score: 42,
        time: 1760000000,
        descendants: 1,
        url: 'https://maitask.com/docs',
        kids: [2001]
      },
      '/v0/item/1002.json': {
        id: 1002,
        type: 'story',
        title: 'Runtime package output contract',
        by: 'runtime',
        score: 18,
        time: 1760000300,
        descendants: 0,
        text: 'Contract details'
      },
      '/v0/item/2001.json': {
        id: 2001,
        type: 'comment',
        by: 'reader',
        parent: 1001,
        time: 1760000400,
        text: 'Useful checklist'
      }
    };

    const body = routes[url.pathname];
    return body === undefined ? null : { body };
  });
  t.after(() => server.close());

  const result = await executeHackerNews({
    storyType: 'top',
    limit: 2,
    includeComments: true,
    commentDepth: 2,
    apiBaseUrl: `${server.url}/v0`
  });

  assert.equal(result.success, true);
  assert.equal(result.data.totalStories, 2);
  assert.equal(result.data.stories[0].title, 'Maitask release checklist');
  assert.equal(result.data.stories[0].comments[0].text, 'Useful checklist');
  assert.equal(result.metadata.provider, 'hackernews');

  const withoutComments = await executeHackerNews({
    storyType: 'top',
    limit: 1,
    includeComments: true,
    commentLimit: 0,
    apiBaseUrl: `${server.url}/v0`
  });

  assert.equal(withoutComments.success, true);
  assert.equal(withoutComments.data.stories[0].comments, undefined);
});

test('web-search parses DuckDuckGo-compatible fixture results through baseUrl', async t => {
  const server = await createFixtureServer(url => {
    if (url.pathname !== '/html/') return null;

    return {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: `
        <html>
          <body>
            <div class="result result--web">
              <h2 class="result__title">
                <a rel="nofollow noopener noreferrer" href="https://maitask.com/docs">Maitask Docs</a>
              </h2>
              <div class="result__snippet">Production workflow documentation.</div>
            </div>
          </body>
        </html>
      `
    };
  });
  t.after(() => server.close());

  const result = await executeWebSearch({
    query: 'maitask',
    engine: 'duckduckgo',
    limit: 1,
    baseUrl: server.url
  });

  assert.equal(result.success, true);
  assert.equal(result.data.totalResults, 1);
  assert.equal(result.data.results[0].title, 'Maitask Docs');
  assert.equal(result.data.results[0].url, 'https://maitask.com/docs');
  assert.equal(result.metadata.sourceUrl, `${server.url}/html/?q=maitask&kl=en-us&kp=1`);
});

test('web-search reports upstream request failures as structured failures', async t => {
  const server = await createFixtureServer(url => {
    if (url.pathname !== '/html/') return null;

    return {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'search unavailable'
    };
  });
  t.after(() => server.close());

  const result = await executeWebSearch({
    query: 'maitask',
    engine: 'duckduckgo',
    baseUrl: server.url
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'WEB_SEARCH_ERROR');
  assert.equal(result.error.type, 'WebSearchRequestError');
  assert.match(result.error.message, /status 503/);
  assert.equal(result.metadata.version, '0.1.1');
});

test('graphql-client executes queries against a fixture endpoint', async t => {
  const server = await createFixtureServer((url, request) => {
    if (url.pathname !== '/graphql') return null;

    assert.equal(request.method, 'POST');
    return {
      body: {
        data: {
          countries: [{ code: 'MT', name: 'Maitask Fixture' }]
        },
        extensions: { fixture: true }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeGraphql({
    url: `${server.url}/graphql`,
    query: 'query MatrixCountries { countries { code name } }',
    variables: {},
    timeoutMs: 10000
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.data.countries, [{ code: 'MT', name: 'Maitask Fixture' }]);
  assert.deepEqual(result.data.errors, []);
  assert.equal(result.data.extensions.fixture, true);
});

test('web-scraper handles fixture pages and preserves partial success counts', async t => {
  const server = await createFixtureServer(url => {
    if (url.pathname === '/article') {
      return {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: `
          <!doctype html>
          <html>
            <head>
              <title>Fixture Article</title>
              <meta name="description" content="Fixture description">
            </head>
            <body>
              <main>
                <h1>Fixture Article</h1>
                <p>First paragraph</p>
                <a class="cta" href="/signup">Start</a>
              </main>
            </body>
          </html>
        `
      };
    }

    if (url.pathname === '/missing') {
      return {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: 'missing'
      };
    }

    return null;
  });
  t.after(() => server.close());

  const result = await executeWebScraper(
    [{ url: `${server.url}/article` }, { url: `${server.url}/missing` }],
    {
      selectors: {
        headline: 'h1',
        ctaHref: { selector: 'a.cta', attr: 'href' }
      },
      xpath: {
        firstParagraph: '//p[1]/text()'
      }
    },
    { execution_id: 'fixture-execution' }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.summary.total, 2);
  assert.equal(result.data.summary.success_count, 1);
  assert.equal(result.data.summary.failure_count, 1);
  assert.equal(result.data.items[0].data.title, 'Fixture Article');
  assert.deepEqual(result.data.items[0].data.customData.headline, ['Fixture Article']);
  assert.deepEqual(result.data.items[0].data.customData.ctaHref, ['/signup']);
  assert.deepEqual(result.data.items[0].data.customData.firstParagraph, ['First paragraph']);
  assert.equal(result.data.items[1].metadata.success, false);
});

test('intelligence-briefing generates a fixture-backed AI briefing', async t => {
  const server = await createFixtureServer(url => {
    const routes = {
      '/v0/topstories.json': [1001, 1002],
      '/v0/item/1001.json': {
        id: 1001,
        type: 'story',
        title: 'Database engine improves analytical query latency',
        by: 'maintainer',
        score: 180,
        time: 1783555200,
        descendants: 42,
        url: 'https://example.com/database-latency',
        kids: [2001],
        text: 'Storage engine improvements reduce write amplification.'
      },
      '/v0/item/1002.json': {
        id: 1002,
        type: 'story',
        title: 'AI infrastructure reporting proposal',
        by: 'policywatch',
        score: 95,
        time: 1783558800,
        descendants: 25,
        url: 'https://example.com/ai-policy'
      },
      '/v0/item/2001.json': {
        id: 2001,
        type: 'comment',
        by: 'reader',
        parent: 1001,
        time: 1783559000,
        text: 'This could change operational cost models.'
      },
      '/v1/chat/completions': {
        id: 'chatcmpl-fixture',
        object: 'chat.completion',
        model: 'fixture-intelligence',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                title: '受控情报简报',
                summary: '两个信号分别指向数据库性能和 AI 基础设施监管。',
                items: [
                  {
                    id: 'hackernews:1001',
                    title: '数据库延迟改善',
                    signal: 'high',
                    analysis: '该更新可能降低分析型负载的基础设施成本。',
                    impact: '对数据平台和云数据库产品有直接影响。',
                    forecast: '短期关注基准测试和生产迁移案例。',
                    risks: ['基准测试与真实负载可能存在差异'],
                    watchlist: ['database']
                  },
                  {
                    id: 'hackernews:1002',
                    title: 'AI 基础设施报告',
                    signal: 'medium',
                    analysis: '报告义务可能提高大型运营商的合规成本。',
                    impact: '影响模型服务、容量规划和事故披露。',
                    forecast: '后续应关注监管文本和行业反馈。',
                    risks: ['政策落地周期不确定'],
                    watchlist: ['ai infrastructure']
                  }
                ],
                message: '受控情报简报\n1. 数据库延迟改善\n2. AI 基础设施报告'
              })
            }
          }
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 120,
          total_tokens: 220
        }
      }
    };

    const body = routes[url.pathname];
    return body === undefined ? null : { body };
  });
  t.after(() => server.close());

  const result = await executeIntelligenceBriefing(
    {
      sources: [
        {
          type: 'hackernews',
          storyTypes: ['top'],
          limit: 2,
          includeComments: true,
          commentLimit: 1,
          commentDepth: 1,
          apiBaseUrl: `${server.url}/v0`
        }
      ],
      analysis: {
        profile: 'forecast',
        targetLanguage: 'zh-CN',
        focus: ['economic impact', 'risk signals']
      },
      selection: {
        maxItems: 2,
        minScore: 1
      },
      output: {
        maxCharacters: 2000
      }
    },
    {
      apiKey: 'fixture-key',
      baseUrl: `${server.url}/v1`,
      model: 'fixture-intelligence'
    },
    { execution_id: 'fixture-intelligence' }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.summary.total, 2);
  assert.equal(result.data.summary.failure_count, 0);
  assert.equal(result.data.briefing.language, 'zh-CN');
  assert.equal(result.data.items[0].data.insight.signal, 'high');
  assert.match(result.data.message, /受控情报简报/);
  assert.equal(result.metadata.contract_version, '2026-06-27');
  assert.equal(result.metadata.ai_provider, 'openai_compatible');
  assert.match(result.metadata.channel_message, /受控情报简报/);
  assert.equal(result.metadata.next_dedupe_state.seen.length, 2);
  assert.equal(result.citations.length, 2);
});

test('intelligence-briefing uses Runtime fetch without abort timers', async t => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requested = [];

  globalThis.Deno = {
    core: {
      ops: {
        op_http_request() {}
      }
    }
  };
  globalThis.setTimeout = () => {
    throw new Error('Runtime fetch path must not create timeout timers');
  };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async url => {
    requested.push(String(url));
    const path = new URL(String(url)).pathname;
    const routes = {
      '/v0/topstories.json': [1001, 1002],
      '/v0/item/1001.json': {
        id: 1001,
        type: 'story',
        title: 'Runtime fetch avoids timers',
        score: 50,
        time: 1783555200,
        descendants: 0,
        url: 'https://example.com/runtime-fetch'
      },
      '/v0/item/1002.json': {
        id: 1002,
        type: 'story',
        title: 'Package execution stays within policy',
        score: 45,
        time: 1783558800,
        descendants: 0,
        url: 'https://example.com/runtime-policy'
      }
    };
    const body = routes[path];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    };
  };

  t.after(() => {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const result = await executeIntelligenceBriefing({
    sources: [
      {
        type: 'hackernews',
        storyTypes: ['top'],
        limit: 2,
        apiBaseUrl: 'https://fixture.local/v0'
      }
    ],
    analysis: {
      profile: 'forecast',
      targetLanguage: 'en'
    },
    ai: {
      provider: 'extractive'
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.summary.total, 2);
  assert.equal(requested.length, 3);
});

test('intelligence-briefing consumes upstream Hacker News output and filters seen items', async () => {
  const result = await executeIntelligenceBriefing({
    data: {
      stories: [
        {
          id: 1001,
          source: 'hackernews',
          title: 'Already delivered story',
          score: 120,
          commentCount: 10,
          time: '2026-07-09T00:00:00Z',
          url: 'https://example.com/seen'
        },
        {
          id: 1002,
          source: 'hackernews',
          title: 'New story for the channel',
          score: 140,
          commentCount: 18,
          time: '2026-07-09T01:00:00Z',
          url: 'https://example.com/new'
        }
      ]
    },
    analysis: {
      profile: 'economic',
      targetLanguage: 'en'
    },
    selection: {
      maxItems: 5
    },
    dedupe: {
      windowHours: 72,
      seen: [
        {
          key: 'hackernews:1001',
          seenAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
        }
      ]
    },
    ai: {
      provider: 'extractive'
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.summary.total, 1);
  assert.equal(result.data.items[0].id, 'hackernews:1002');
  assert.equal(result.data.nextDedupeState.seen.some(item => item.key === 'hackernews:1001'), true);
  assert.equal(result.data.nextDedupeState.seen.some(item => item.key === 'hackernews:1002'), true);
});

test('intelligence-briefing consumes Runtime-standardized Hacker News envelope', async () => {
  const result = await executeIntelligenceBriefing({
    data: {
      items: [
        {
          data: {
            stories: [
              {
                id: 2001,
                source: 'hackernews',
                title: 'Runtime envelope story',
                score: 160,
                commentCount: 24,
                time: '2026-07-09T02:00:00Z',
                url: 'https://example.com/runtime-envelope'
              }
            ],
            storyType: 'top',
            totalStories: 1
          },
          metadata: {
            package: '@maitask/hackernews-crawler',
            version: '0.1.0'
          }
        }
      ],
      summary: {
        total: 1,
        success_count: 1,
        failure_count: 0
      }
    },
    metadata: {
      package: '@maitask/hackernews-crawler',
      provider: 'hackernews'
    },
    analysis: {
      profile: 'forecast',
      targetLanguage: 'en'
    },
    ai: {
      provider: 'extractive'
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.summary.total, 1);
  assert.equal(result.data.summary.metrics.collected, 1);
  assert.equal(result.data.items[0].id, 'hackernews:2001');
});

test('intelligence-briefing returns structured failure when AI credentials are missing', async () => {
  const result = await executeIntelligenceBriefing({
    sourceData: [
      {
        id: 1001,
        source: 'hackernews',
        title: 'Needs model analysis',
        score: 100,
        commentCount: 20
      }
    ],
    analysis: {
      profile: 'forecast',
      targetLanguage: 'en'
    },
    ai: {
      provider: 'openai_compatible'
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.data.summary.failure_count, 1);
  assert.equal(result.error.code, 'INTELLIGENCE_BRIEFING_ERROR');
  assert.match(result.error.message, /AI API key is required/);
});
