const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { execute: executeGraphql } = require('../graphql-client');
const { execute: executeHackerNews } = require('../hackernews-crawler');
const { execute: executeWebScraper } = require('../web-scraper');
const { execute: executeWebSearch } = require('../web-search');

function createFixtureServer(handler) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const result = handler(url, request);

    if (!result) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }

    const status = result.status || 200;
    const headers = result.headers || { 'content-type': 'application/json; charset=utf-8' };
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    response.writeHead(status, headers);
    response.end(body);
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
