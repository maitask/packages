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
    allowedAuthHosts: ['127.0.0.1'],
    allowPrivateHosts: true,
    maxRedirects: 5,
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    ...overrides
  };
}

function assertSafeFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
  assert.equal(Object.hasOwn(result.error, 'details'), false);
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

test('cf-proxy accepts only the formal read-only input contract without invoking accessors', async () => {
  let accessorReads = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, 'url', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'https://api.github.com/private';
    }
  });

  const customPrototype = Object.create({ inherited: true });
  customPrototype.url = 'https://api.github.com/private';

  const cyclicConfig = {};
  cyclicConfig.self = cyclicConfig;

  const cases = [
    accessorInput,
    customPrototype,
    { url: 'https://api.github.com', unexpected: true },
    { url: 'https://api.github.com', config: { max_redirects: 2 } },
    { url: 'https://api.github.com', config: cyclicConfig },
    { url: 'https://api.github.com', method: 'POST' },
    { url: 'https://user:password@api.github.com/private' },
    { url: 'https://api.github.com/private#secret-fragment' },
    { url: 'https://api.github.com', headers: { Host: 'attacker.example' } },
    { url: 'https://api.github.com', headers: { 'X-Test': 'safe\r\nX-Injected: yes' } }
  ];

  const symbolInput = { url: 'https://api.github.com' };
  symbolInput[Symbol('secret')] = 'hidden';
  cases.push(symbolInput);

  for (const input of cases) {
    const result = await execute(input);
    assertSafeFailure(result, 'CF_PROXY_VALIDATION');
    assert.doesNotMatch(JSON.stringify(result), /password|secret-fragment|attacker\.example|X-Injected|hidden/);
  }

  assert.equal(accessorReads, 0);
});

test('cf-proxy enforces GET and HEAD wire behavior', async t => {
  const requests = [];
  const server = await createServer((request, response) => {
    requests.push({ method: request.method, bodyLength: Number(request.headers['content-length'] || 0) });
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : Buffer.from([1, 2, 3]));
  });
  t.after(() => server.close());

  const getResult = await execute({
    url: `${server.url}/get`,
    method: 'GET',
    config: fixtureConfig()
  });
  const headResult = await execute({
    url: `${server.url}/head`,
    method: 'HEAD',
    config: fixtureConfig()
  });

  assert.equal(getResult.success, true);
  assert.equal(getResult.data.bodyBase64, Buffer.from([1, 2, 3]).toString('base64'));
  assert.equal(headResult.success, true);
  assert.equal(headResult.data.bodyBase64, '');
  assert.equal(headResult.data.bodyBytes, 0);
  assert.deepEqual(requests, [
    { method: 'GET', bodyLength: 0 },
    { method: 'HEAD', bodyLength: 0 }
  ]);
});

test('cf-proxy enforces timeout and response-size limits with stable safe errors', async t => {
  const oversized = await createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(Buffer.alloc(128, 0x41));
  });
  const slow = await createServer((_request, response) => {
    setTimeout(() => response.end('late secret at http://127.0.0.1/private'), 150);
  });
  t.after(() => Promise.all([oversized.close(), slow.close()]));

  const sizeResult = await execute({
    url: `${oversized.url}/large?token=response-secret`,
    config: fixtureConfig({ maxResponseBytes: 32 })
  });
  const timeoutResult = await execute({
    url: `${slow.url}/slow?token=timeout-secret`,
    config: fixtureConfig({ timeoutMs: 25 })
  });

  assertSafeFailure(sizeResult, 'CF_PROXY_RESPONSE_TOO_LARGE');
  assertSafeFailure(timeoutResult, 'CF_PROXY_TIMEOUT');
  assert.doesNotMatch(JSON.stringify([sizeResult, timeoutResult]), /response-secret|timeout-secret|127\.0\.0\.1|private/);
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`cf-proxy follows ${status} with the original read-only method and same-origin credentials`, async t => {
    const requests = [];
    let server;
    server = await createServer((request, response) => {
      requests.push({
        path: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        trace: request.headers['x-trace-id']
      });
      if (request.url === '/start') {
        response.writeHead(status, { location: `${server.url}/final` });
        response.end();
        return;
      }
      response.end('done');
    });
    t.after(() => server.close());

    const result = await execute({
      url: `${server.url}/start`,
      method: 'HEAD',
      headers: {
        Authorization: 'Bearer same-origin-secret',
        Cookie: 'session=same-origin-cookie',
        'X-Trace-Id': 'trace-same-origin'
      },
      config: fixtureConfig()
    });

    assert.equal(result.success, true);
    assert.deepEqual(requests, [
      {
        path: '/start',
        method: 'HEAD',
        authorization: 'Bearer same-origin-secret',
        cookie: 'session=same-origin-cookie',
        trace: 'trace-same-origin'
      },
      {
        path: '/final',
        method: 'HEAD',
        authorization: 'Bearer same-origin-secret',
        cookie: 'session=same-origin-cookie',
        trace: 'trace-same-origin'
      }
    ]);
    assert.doesNotMatch(JSON.stringify(result), /same-origin-secret|same-origin-cookie/);
  });
}

test('cf-proxy rejects redirects without locations and redirect loops without exposing targets', async t => {
  let server;
  server = await createServer((request, response) => {
    if (request.url === '/missing') {
      response.writeHead(302);
      response.end();
      return;
    }
    response.writeHead(307, { location: `${server.url}/loop?token=redirect-loop-secret` });
    response.end();
  });
  t.after(() => server.close());

  const missing = await execute({
    url: `${server.url}/missing`,
    config: fixtureConfig()
  });
  const loop = await execute({
    url: `${server.url}/loop?token=initial-secret`,
    config: fixtureConfig({ maxRedirects: 2 })
  });

  assertSafeFailure(missing, 'CF_PROXY_REDIRECT');
  assertSafeFailure(loop, 'CF_PROXY_REDIRECT');
  assert.doesNotMatch(JSON.stringify([missing, loop]), /redirect-loop-secret|initial-secret|127\.0\.0\.1/);
});

test('cf-proxy performs constrained Docker bearer authentication and confines the token to the registry origin', async t => {
  const tokenSecret = 'registry-token-secret';
  let tokenHeaders;
  let redirectedHeaders;
  let registryRequests = 0;

  const redirectTarget = await createServer((request, response) => {
    redirectedHeaders = request.headers;
    response.end('manifest');
  });
  const tokenServer = await createServer((request, response) => {
    tokenHeaders = request.headers;
    assert.equal(request.url, '/token?service=fixture-registry&scope=repository%3Alibrary%2Fdemo%3Apull');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ access_token: tokenSecret }));
  });
  const registry = await createServer((request, response) => {
    registryRequests += 1;
    if (registryRequests === 1) {
      response.writeHead(401, {
        'www-authenticate': `Bearer scope="repository:library/demo:pull", realm="${tokenServer.url}/token", service="fixture-registry"`
      });
      response.end('caller-token-secret');
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${tokenSecret}`);
    response.writeHead(307, { location: `${redirectTarget.url}/manifest` });
    response.end();
  });
  t.after(() => Promise.all([registry.close(), tokenServer.close(), redirectTarget.close()]));

  const result = await execute({
    url: `${registry.url}/v2/library/demo/manifests/latest`,
    headers: {
      Authorization: 'Bearer caller-token-secret',
      Cookie: 'registry-cookie-secret',
      'X-Trace-Id': 'registry-trace'
    },
    config: fixtureConfig({
      dockerRegistryHosts: ['127.0.0.1'],
      allowedAuthHosts: ['127.0.0.1']
    })
  });

  assert.equal(result.success, true);
  assert.equal(registryRequests, 2);
  assert.equal(tokenHeaders.authorization, undefined);
  assert.equal(tokenHeaders.cookie, undefined);
  assert.equal(tokenHeaders['x-trace-id'], undefined);
  assert.equal(redirectedHeaders.authorization, undefined);
  assert.equal(redirectedHeaders.cookie, undefined);
  assert.equal(redirectedHeaders['x-trace-id'], 'registry-trace');
  assert.doesNotMatch(JSON.stringify(result), /registry-token-secret|caller-token-secret|registry-cookie-secret/);
});

test('cf-proxy rejects unapproved Docker token realms before contact', async t => {
  let tokenRequests = 0;
  const tokenServer = await createServer((_request, response) => {
    tokenRequests += 1;
    response.end(JSON.stringify({ token: 'should-not-be-read' }));
  });
  const registry = await createServer((_request, response) => {
    response.writeHead(401, {
      'www-authenticate': `Bearer realm="${tokenServer.localhostUrl}/token",service="fixture",scope="repository:demo:pull"`
    });
    response.end();
  });
  t.after(() => Promise.all([registry.close(), tokenServer.close()]));

  const result = await execute({
    url: `${registry.url}/v2/demo/manifests/latest`,
    config: fixtureConfig({
      dockerRegistryHosts: ['127.0.0.1'],
      allowedAuthHosts: ['127.0.0.1']
    })
  });

  assertSafeFailure(result, 'CF_PROXY_AUTH');
  assert.equal(tokenRequests, 0);
  assert.doesNotMatch(JSON.stringify(result), /localhost|token|fixture|demo/);
});

test('cf-proxy normalizes arbitrary transport exceptions without exposing exception data', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Bearer arbitrary-secret at https://api.github.com/private');
  };

  try {
    const result = await execute({ url: 'https://api.github.com/repos' });
    assertSafeFailure(result, 'CF_PROXY_UPSTREAM');
    assert.doesNotMatch(JSON.stringify(result), /arbitrary-secret|api\.github\.com|private/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('cf-proxy requires the Runtime transport to return bounded base64 bytes', async () => {
  const originalDeno = globalThis.Deno;
  const calls = [];
  let validResponse = true;
  globalThis.Deno = {
    core: {
      ops: {
        op_http_request: async (url, options) => {
          calls.push({ url, options });
          if (!validResponse) {
            return {
              status: 200,
              headers: {},
              body: 'Bearer runtime-response-secret'
            };
          }
          return {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
            bodyBase64: Buffer.from([0x00, 0xff, 0x41]).toString('base64'),
            bodyBytes: 3
          };
        }
      }
    }
  };

  try {
    const success = await execute({
      url: 'https://api.github.com/runtime-binary',
      config: {
        timeoutMs: 500,
        maxResponseBytes: 64
      }
    });
    assert.equal(success.success, true);
    assert.equal(success.data.bodyBase64, Buffer.from([0x00, 0xff, 0x41]).toString('base64'));
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.timeoutMs <= 500, true);
    assert.equal(calls[0].options.maxResponseBytes, 64);

    validResponse = false;
    const malformed = await execute({ url: 'https://api.github.com/runtime-text' });
    assertSafeFailure(malformed, 'CF_PROXY_UPSTREAM');
    assert.doesNotMatch(JSON.stringify(malformed), /runtime-response-secret|api\.github\.com|runtime-text/);
  } finally {
    if (originalDeno === undefined) {
      delete globalThis.Deno;
    } else {
      globalThis.Deno = originalDeno;
    }
  }
});
