const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { execute } = require('../cf-proxy');

function createServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        localhostUrl: `http://localhost:${address.port}`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

function fixtureConfig(overrides = {}) {
  return {
    allowedHosts: ['127.0.0.1'],
    allowPrivateHosts: true,
    maxRedirects: 5,
    ...overrides
  };
}

test('cf-proxy preserves binary response bytes as base64', async t => {
  const bytes = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x42, 0x0a]);
  const server = await createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length)
    });
    response.end(bytes);
  });
  t.after(() => server.close());

  const result = await execute({
    url: `${server.url}/artifact.bin`,
    config: fixtureConfig()
  });

  assert.equal(result.success, true);
  assert.equal(result.data.bodyEncoding, 'base64');
  assert.equal(result.data.bodyBase64, bytes.toString('base64'));
  assert.equal(result.data.bodyBytes, bytes.length);
  assert.equal(Object.hasOwn(result.data, 'body'), false);
});

test('cf-proxy requires explicit private-host access', async t => {
  let requests = 0;
  const server = await createServer((_request, response) => {
    requests += 1;
    response.end('unexpected');
  });
  t.after(() => server.close());

  const result = await execute({
    url: `${server.url}/private`,
    config: { allowedHosts: ['127.0.0.1'] }
  });

  assert.equal(result.success, false);
  assert.match(result.error.message, /private|local/i);
  assert.equal(requests, 0);
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1/);
});

test('cf-proxy revalidates redirect hosts before contacting them', async t => {
  let redirectedRequests = 0;
  const target = await createServer((_request, response) => {
    redirectedRequests += 1;
    response.end('redirected');
  });
  const source = await createServer((_request, response) => {
    response.writeHead(302, { location: `${target.localhostUrl}/blocked` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute({
    url: `${source.url}/start`,
    config: fixtureConfig({ allowedHosts: ['127.0.0.1'] })
  });

  assert.equal(result.success, false);
  assert.equal(redirectedRequests, 0);
  assert.doesNotMatch(JSON.stringify(result), /localhost|blocked/);
});

test('cf-proxy removes credentials before an allowed cross-origin redirect', async t => {
  let redirectedHeaders;
  const target = await createServer((request, response) => {
    redirectedHeaders = request.headers;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });
  const source = await createServer((_request, response) => {
    response.writeHead(307, { location: `${target.localhostUrl}/allowed` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute({
    url: `${source.url}/start`,
    headers: {
      Authorization: 'Bearer redirect-secret',
      Cookie: 'session=redirect-cookie',
      'Proxy-Authorization': 'Basic proxy-secret',
      'X-Trace-Id': 'trace-1'
    },
    config: fixtureConfig({ allowedHosts: ['127.0.0.1', 'localhost'] })
  });

  assert.equal(result.success, true);
  assert.equal(redirectedHeaders['x-trace-id'], 'trace-1');
  assert.equal(redirectedHeaders.authorization, undefined);
  assert.equal(redirectedHeaders.cookie, undefined);
  assert.equal(redirectedHeaders['proxy-authorization'], undefined);
  assert.doesNotMatch(JSON.stringify(result), /redirect-secret|redirect-cookie|proxy-secret/);
});
