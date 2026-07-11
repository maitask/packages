const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');

const { execute } = require('../http-request');

const SECRET_PATTERN = /bearer-secret|basic-user|basic-password|api-key-secret|exception-secret/i;

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        localhostUrl: `http://localhost:${address.port}`,
        close: () => new Promise(closeResolve => {
          server.close(() => closeResolve());
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        })
      });
    });
  });
}

function fixtureOptions(overrides = {}) {
  return {
    allowInsecureHttp: true,
    allowedHosts: ['127.0.0.1'],
    timeoutMs: 2_000,
    maxResponseBytes: 1024 * 1024,
    ...overrides
  };
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function json(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    ...headers
  });
  response.end(body);
}

function text(response, status, value, headers = {}) {
  const body = Buffer.from(value);
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.byteLength),
    ...headers
  });
  response.end(body);
}

function assertFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
  assert.equal(result.metadata.package, '@maitask/http-request');
  assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
}

function responseData(result) {
  assert.equal(result.success, true);
  assert.equal(result.data.items.length, 1);
  return result.data.items[0].data;
}

test('http-request sends normalized query values and caller headers', async t => {
  let observed;
  const server = await listen((request, response) => {
    observed = {
      method: request.method,
      url: request.url,
      accept: request.headers.accept,
      trace: request.headers['x-trace-id'],
      userAgent: request.headers['user-agent']
    };
    json(response, 200, { ok: true });
  });
  t.after(server.close);

  const result = await execute({
    url: `${server.url}/resource?existing=1`,
    method: 'GET',
    query: {
      search: 'formal contract',
      page: 2,
      active: true,
      tag: ['runtime', 'packages']
    },
    headers: {
      Accept: 'application/json',
      'X-Trace-Id': 'trace-1'
    },
    responseType: 'json'
  }, fixtureOptions(), { executionId: 'execution-1' });

  assert.deepEqual(observed, {
    method: 'GET',
    url: '/resource?existing=1&search=formal+contract&page=2&active=true&tag=runtime&tag=packages',
    accept: 'application/json',
    trace: 'trace-1',
    userAgent: '@maitask/http-request/2.0.0'
  });
  assert.deepEqual(responseData(result).body, { ok: true });
  assert.equal(result.metadata.executionId, 'execution-1');
  assert.equal(result.metadata.attempts, 1);
});

test('http-request preserves JSON, text, Base64, form, and multipart request bodies', async t => {
  const requests = [];
  const server = await listen(async (request, response) => {
    requests.push({
      path: request.url,
      contentType: request.headers['content-type'],
      body: await readRequest(request)
    });
    response.writeHead(204);
    response.end();
  });
  t.after(server.close);

  const cases = [
    {
      path: '/json',
      input: { json: { name: 'Maitask', nested: { enabled: true } } }
    },
    {
      path: '/text',
      input: { text: '正式文本🚀' }
    },
    {
      path: '/base64',
      input: { bodyBase64: 'AP9B' }
    },
    {
      path: '/form',
      input: { form: { name: 'Maitask', tag: ['runtime', 'packages'], enabled: true } }
    },
    {
      path: '/multipart',
      input: {
        multipart: {
          name: 'Maitask',
          tag: ['runtime', 'packages'],
          artifact: {
            filename: 'artifact.bin',
            contentType: 'application/octet-stream',
            bodyBase64: 'AP9B'
          }
        }
      }
    }
  ];

  for (const item of cases) {
    const result = await execute({
      url: `${server.url}${item.path}`,
      method: 'POST',
      responseType: 'text',
      ...item.input
    }, fixtureOptions());
    assert.equal(result.success, true);
  }

  assert.equal(requests[0].contentType, 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(requests[0].body.toString('utf8')), {
    name: 'Maitask', nested: { enabled: true }
  });
  assert.equal(requests[1].contentType, 'text/plain; charset=utf-8');
  assert.equal(requests[1].body.toString('utf8'), '正式文本🚀');
  assert.equal(requests[2].contentType, 'application/octet-stream');
  assert.deepEqual(requests[2].body, Buffer.from([0, 255, 65]));
  assert.equal(requests[3].contentType, 'application/x-www-form-urlencoded; charset=utf-8');
  assert.equal(requests[3].body.toString('utf8'), 'name=Maitask&tag=runtime&tag=packages&enabled=true');
  assert.match(requests[4].contentType, /^multipart\/form-data; boundary=/);
  const multipart = requests[4].body.toString('latin1');
  assert.match(multipart, /name="name"\r\n\r\nMaitask/);
  assert.match(multipart, /name="tag"\r\n\r\nruntime/);
  assert.match(multipart, /filename="artifact.bin"/);
  assert.match(multipart, /Content-Type: application\/octet-stream/i);
  assert.equal(requests[4].body.includes(Buffer.from([0, 255, 65])), true);
});

test('http-request resolves every authentication scheme from trusted secrets', async t => {
  const observed = [];
  const server = await listen((request, response) => {
    observed.push({
      authorization: request.headers.authorization,
      apiKey: request.headers['x-api-key']
    });
    json(response, 200, { ok: true });
  });
  t.after(server.close);

  const context = {
    secrets: {
      BEARER_TOKEN: 'bearer-secret',
      BASIC_USER: 'basic-user',
      BASIC_PASSWORD: 'basic-password'
    }
  };
  const inputs = [
    { auth: { type: 'bearer', tokenSecret: 'BEARER_TOKEN' } },
    {
      auth: {
        type: 'basic',
        usernameSecret: 'BASIC_USER',
        passwordSecret: 'BASIC_PASSWORD'
      }
    },
    { auth: { type: 'apiKey', header: 'X-API-Key', valueSecret: 'API_KEY' } }
  ];

  for (const input of inputs) {
    const result = await execute({
      url: `${server.url}/auth`,
      responseType: 'json',
      ...input
    }, fixtureOptions({ secrets: { API_KEY: 'api-key-secret' } }), context);
    assert.equal(result.success, true);
    assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
  }

  assert.deepEqual(observed, [
    { authorization: 'Bearer bearer-secret', apiKey: undefined },
    {
      authorization: `Basic ${Buffer.from('basic-user:basic-password').toString('base64')}`,
      apiKey: undefined
    },
    { authorization: undefined, apiKey: 'api-key-secret' }
  ]);
});

test('http-request rejects unavailable secrets before network access', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const missing = await execute({
    url: server.url,
    auth: { type: 'bearer', tokenSecret: 'TOKEN' }
  }, fixtureOptions(), {});
  assertFailure(missing, 'HTTP_REQUEST_SECRET_UNAVAILABLE');

  const inherited = await execute({
    url: server.url,
    auth: { type: 'bearer', tokenSecret: 'TOKEN' }
  }, fixtureOptions(), { secrets: Object.create({ TOKEN: 'inherited' }) });
  assertFailure(inherited, 'HTTP_REQUEST_VALIDATION');
  assert.equal(requests, 0);
});

test('http-request rejects behavioral, inherited, symbolic, cyclic, alias, and unknown inputs', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const accessor = {};
  Object.defineProperty(accessor, 'url', { enumerable: true, get() { throw new Error('accessed'); } });
  const symbolic = { url: server.url };
  symbolic[Symbol('hidden')] = true;
  const inherited = Object.create({ url: server.url });
  inherited.method = 'GET';
  const cyclicJson = {};
  cyclicJson.self = cyclicJson;
  const sparseStatuses = [];
  sparseStatuses.length = 1;
  const retryAccessor = {};
  Object.defineProperty(retryAccessor, 'maxAttempts', { enumerable: true, get() { return 1; } });
  const cases = [
    accessor,
    symbolic,
    inherited,
    { url: server.url, json: cyclicJson, method: 'POST' },
    { url: server.url, response_type: 'json' },
    { url: server.url, timeout: 100 },
    { url: server.url, unknown: true },
    { url: server.url, method: 'GET', text: 'not allowed' },
    { url: server.url, headers: Object.create({ Accept: 'application/json' }) },
    { url: server.url, retry: retryAccessor },
    { url: server.url, acceptedStatuses: sparseStatuses }
  ];

  for (const input of cases) {
    const result = await execute(input, fixtureOptions());
    assertFailure(result, 'HTTP_REQUEST_VALIDATION');
  }
  assert.equal(requests, 0);
});

test('http-request rejects duplicate, protected, injected, and managed credential headers', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const headerCases = [
    { Authorization: 'Bearer caller-secret' },
    { Cookie: 'session=caller-secret' },
    { Host: 'attacker.example' },
    { Connection: 'keep-alive' },
    { 'Content-Length': '1' },
    { 'X-Test': 'safe\r\nX-Injected: yes' },
    { Accept: 'application/json', accept: 'text/plain' }
  ];
  for (const headers of headerCases) {
    const result = await execute({ url: server.url, headers }, fixtureOptions());
    assertFailure(result, 'HTTP_REQUEST_VALIDATION');
  }

  const managed = await execute({
    url: server.url,
    headers: { 'X-API-Key': 'caller-value' },
    auth: { type: 'apiKey', header: 'X-API-Key', valueSecret: 'API_KEY' }
  }, fixtureOptions({ secrets: { API_KEY: 'api-key-secret' } }));
  assertFailure(managed, 'HTTP_REQUEST_VALIDATION');

  const multipartContentType = await execute({
    url: server.url,
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=caller' },
    multipart: { name: 'Maitask' },
    retry: { maxAttempts: 1 }
  }, fixtureOptions());
  assertFailure(multipartContentType, 'HTTP_REQUEST_VALIDATION');
  assert.equal(requests, 0);
});

test('http-request snapshots input, headers, JSON, and trusted secrets before asynchronous transport', async t => {
  let observed;
  const server = await listen(async (request, response) => {
    observed = {
      trace: request.headers['x-trace-id'],
      authorization: request.headers.authorization,
      body: JSON.parse((await readRequest(request)).toString('utf8'))
    };
    json(response, 200, { ok: true });
  });
  t.after(server.close);

  const input = {
    url: server.url,
    method: 'POST',
    headers: { 'X-Trace-Id': 'original-trace' },
    auth: { type: 'bearer', tokenSecret: 'TOKEN' },
    json: { nested: { value: 'original-value' } },
    retry: { maxAttempts: 1 }
  };
  const options = fixtureOptions({ secrets: { TOKEN: 'original-token' } });
  const promise = execute(input, options);
  input.headers['X-Trace-Id'] = 'mutated-trace';
  input.json.nested.value = 'mutated-value';
  options.secrets.TOKEN = 'mutated-token';

  const result = await promise;
  assert.equal(result.success, true);
  assert.deepEqual(observed, {
    trace: 'original-trace',
    authorization: 'Bearer original-token',
    body: { nested: { value: 'original-value' } }
  });
  assert.doesNotMatch(JSON.stringify(result), /original-token|mutated-token/);
});

test('http-request preserves exact response bytes for every response representation', async t => {
  const bytes = Buffer.from([0, 255, 65, 195, 40]);
  const server = await listen((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'x-fixture': 'binary',
      'content-length': String(bytes.byteLength)
    });
    response.end(bytes);
  });
  t.after(server.close);

  const result = await execute({
    url: server.url,
    responseType: 'base64'
  }, fixtureOptions());
  const data = responseData(result);
  assert.equal(data.body, bytes.toString('base64'));
  assert.equal(data.bodyBase64, bytes.toString('base64'));
  assert.equal(data.bodyBytes, bytes.byteLength);
  assert.equal(data.headers['x-fixture'], 'binary');
});

test('http-request uses canonical Base64 request and response bytes through the Runtime operation', async () => {
  const originalDeno = global.Deno;
  let observed;
  global.Deno = {
    core: {
      ops: {
        op_http_request: async (url, request) => {
          observed = { url, request };
          return {
            status: 200,
            ok: true,
            headers: { 'content-type': 'application/octet-stream' },
            bodyBase64: '/wBB',
            bodyBytes: 3
          };
        }
      }
    }
  };
  try {
    const result = await execute({
      url: 'https://example.com/binary',
      method: 'POST',
      bodyBase64: 'AP9B',
      responseType: 'base64'
    }, { timeoutMs: 500, maxResponseBytes: 1024 });
    assert.equal(result.success, true);
    assert.equal(responseData(result).bodyBase64, '/wBB');
    assert.equal(observed.url, 'https://example.com/binary');
    assert.equal(observed.request.bodyBase64, 'AP9B');
    assert.equal(observed.request.body, undefined);
    assert.equal(observed.request.redirect, 'manual');
    assert.equal(observed.request.maxResponseBytes, 1024);
  } finally {
    if (originalDeno === undefined) delete global.Deno;
    else global.Deno = originalDeno;
  }
});

test('http-request strictly parses JSON and permits explicitly accepted error statuses', async t => {
  const server = await listen((request, response) => {
    if (request.url === '/invalid') {
      text(response, 200, '{not-json', { 'content-type': 'application/json' });
      return;
    }
    if (request.url === '/invalid-utf8') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
      response.end(Buffer.from([0xc3, 0x28]));
      return;
    }
    json(response, 422, { error: 'controlled response' });
  });
  t.after(server.close);

  const invalid = await execute({
    url: `${server.url}/invalid`,
    responseType: 'json'
  }, fixtureOptions());
  assertFailure(invalid, 'HTTP_REQUEST_RESPONSE_PARSE');
  assert.doesNotMatch(JSON.stringify(invalid), /not-json/);

  const invalidUtf8 = await execute({
    url: `${server.url}/invalid-utf8`,
    responseType: 'text'
  }, fixtureOptions());
  assertFailure(invalidUtf8, 'HTTP_REQUEST_RESPONSE_PARSE');

  const accepted = await execute({
    url: `${server.url}/accepted`,
    responseType: 'json',
    acceptedStatuses: [200, 422]
  }, fixtureOptions());
  assert.equal(accepted.success, true);
  assert.equal(responseData(accepted).status, 422);
  assert.deepEqual(responseData(accepted).body, { error: 'controlled response' });

  const rejected = await execute({
    url: `${server.url}/rejected`,
    responseType: 'json'
  }, fixtureOptions());
  assertFailure(rejected, 'HTTP_REQUEST_STATUS');
  assert.equal(rejected.error.status, 422);
  assert.doesNotMatch(JSON.stringify(rejected), /controlled response/);
});

test('http-request enforces streamed response limits and a total body-read deadline', async t => {
  const server = await listen((request, response) => {
    if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.write(Buffer.alloc(6, 1));
      response.end(Buffer.alloc(6, 2));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('start');
    setTimeout(() => response.end('-finish'), 100);
  });
  t.after(server.close);

  const large = await execute({
    url: `${server.url}/large`,
    responseType: 'base64',
    maxResponseBytes: 8
  }, fixtureOptions({ maxResponseBytes: 64 }));
  assertFailure(large, 'HTTP_REQUEST_RESPONSE_TOO_LARGE');

  const timedOut = await execute({
    url: `${server.url}/slow`,
    responseType: 'text',
    timeoutMs: 30
  }, fixtureOptions({ timeoutMs: 500 }));
  assertFailure(timedOut, 'HTTP_REQUEST_TIMEOUT');

  const cannotLoosen = await execute({
    url: `${server.url}/large`,
    responseType: 'base64',
    maxResponseBytes: 64
  }, fixtureOptions({ maxResponseBytes: 8 }));
  assertFailure(cannotLoosen, 'HTTP_REQUEST_RESPONSE_TOO_LARGE');
});

test('http-request denies insecure public policy, embedded credentials, fragments, and invalid options before contact', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const cases = [
    [{ url: server.url }, {}],
    [{ url: `http://user:password@127.0.0.1:${new URL(server.url).port}/` }, fixtureOptions()],
    [{ url: `${server.url}/#fragment` }, fixtureOptions()],
    [{ url: server.url }, { ...fixtureOptions(), unknown: true }],
    [{ url: server.url }, { ...fixtureOptions(), allowedHosts: ['localhost'] }]
  ];
  for (const [input, options] of cases) {
    const result = await execute(input, options);
    assert.equal(result.success, false);
    assert.match(result.error.code, /^HTTP_REQUEST_(?:VALIDATION|POLICY)$/);
  }
  assert.equal(requests, 0);
});

test('http-request follows same-origin redirects and retains managed credentials', async t => {
  const requests = [];
  let server;
  server = await listen((request, response) => {
    requests.push({
      path: request.url,
      authorization: request.headers.authorization,
      trace: request.headers['x-trace-id']
    });
    if (request.url === '/start') {
      response.writeHead(302, { location: `${server.url}/final` });
      response.end();
      return;
    }
    json(response, 200, { redirected: true });
  });
  t.after(server.close);

  const result = await execute({
    url: `${server.url}/start`,
    headers: { 'X-Trace-Id': 'trace-redirect' },
    auth: { type: 'bearer', tokenSecret: 'TOKEN' },
    responseType: 'json'
  }, fixtureOptions({ secrets: { TOKEN: 'bearer-secret' } }));

  assert.equal(result.success, true);
  assert.equal(result.metadata.redirects, 1);
  assert.deepEqual(requests, [
    { path: '/start', authorization: 'Bearer bearer-secret', trace: 'trace-redirect' },
    { path: '/final', authorization: 'Bearer bearer-secret', trace: 'trace-redirect' }
  ]);
  assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
});

test('http-request strips credentials and non-safe caller headers on cross-origin redirects', async t => {
  let targetRequest;
  const target = await listen((request, response) => {
    targetRequest = {
      authorization: request.headers.authorization,
      apiKey: request.headers['x-api-key'],
      trace: request.headers['x-trace-id'],
      accept: request.headers.accept,
      acceptLanguage: request.headers['accept-language']
    };
    json(response, 200, { ok: true });
  });
  const source = await listen((_request, response) => {
    response.writeHead(302, { location: `${target.url}/final` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute({
    url: `${source.url}/start`,
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'zh-CN',
      'X-Trace-Id': 'must-not-cross-origin'
    },
    auth: { type: 'apiKey', header: 'X-API-Key', valueSecret: 'API_KEY' },
    responseType: 'json'
  }, fixtureOptions({ secrets: { API_KEY: 'api-key-secret' } }));

  assert.equal(result.success, true);
  assert.deepEqual(targetRequest, {
    authorization: undefined,
    apiKey: undefined,
    trace: undefined,
    accept: 'application/json',
    acceptLanguage: 'zh-CN'
  });
});

test('http-request supports manual redirects and rejects error-mode or disallowed redirects before contact', async t => {
  let targetRequests = 0;
  const target = await listen((_request, response) => {
    targetRequests += 1;
    json(response, 200, { contacted: true });
  });
  const source = await listen((_request, response) => {
    response.writeHead(302, { location: `${target.localhostUrl}/target` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const manual = await execute({
    url: source.url,
    redirect: 'manual',
    acceptedStatuses: [302],
    responseType: 'base64'
  }, fixtureOptions());
  assert.equal(manual.success, true);
  assert.equal(responseData(manual).status, 302);
  assert.equal(targetRequests, 0);

  const rejected = await execute({
    url: source.url,
    redirect: 'error'
  }, fixtureOptions());
  assertFailure(rejected, 'HTTP_REQUEST_REDIRECT');
  assert.equal(targetRequests, 0);

  const disallowed = await execute({ url: source.url }, fixtureOptions());
  assertFailure(disallowed, 'HTTP_REQUEST_POLICY');
  assert.equal(targetRequests, 0);
});

test('http-request never follows or replays a write redirect', async t => {
  let sourceRequests = 0;
  let targetRequests = 0;
  const target = await listen((_request, response) => {
    targetRequests += 1;
    response.end();
  });
  const source = await listen((request, response) => {
    sourceRequests += 1;
    request.resume();
    response.writeHead(307, { location: `${target.url}/write` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute({
    url: source.url,
    method: 'POST',
    json: { write: true },
    retry: { maxAttempts: 1 }
  }, fixtureOptions());
  assertFailure(result, 'HTTP_REQUEST_REDIRECT');
  assert.equal(sourceRequests, 1);
  assert.equal(targetRequests, 0);
});

test('http-request retries safe status failures and honors the configured attempt ceiling', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    if (requests < 3) {
      text(response, 503, 'retry body must not escape', { 'retry-after': '0' });
      return;
    }
    json(response, 200, { recovered: true });
  });
  t.after(server.close);

  const result = await execute({
    url: server.url,
    responseType: 'json',
    retry: {
      maxAttempts: 3,
      statuses: [503],
      initialDelayMs: 1,
      maxDelayMs: 5,
      backoffFactor: 2,
      jitterRatio: 0,
      respectRetryAfter: true
    }
  }, fixtureOptions());

  assert.equal(result.success, true);
  assert.equal(requests, 3);
  assert.equal(result.metadata.attempts, 3);
  assert.doesNotMatch(JSON.stringify(result), /retry body must not escape/);
});

test('http-request never retries unsafe methods after timeouts', async t => {
  const counts = new Map();
  const server = await listen((request, response) => {
    counts.set(request.method, (counts.get(request.method) || 0) + 1);
    request.resume();
    setTimeout(() => {
      if (!response.destroyed) json(response, 200, { late: true });
    }, 80);
  });
  t.after(server.close);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await execute({
      url: server.url,
      method,
      json: { operation: method },
      timeoutMs: 20,
      retry: { maxAttempts: 1 }
    }, fixtureOptions({ timeoutMs: 500 }));
    assertFailure(result, 'HTTP_REQUEST_TIMEOUT');
  }
  assert.deepEqual(Object.fromEntries(counts), { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 });

  const invalidReplay = await execute({
    url: server.url,
    method: 'POST',
    json: { operation: 'POST' },
    retry: { maxAttempts: 2 }
  }, fixtureOptions());
  assertFailure(invalidReplay, 'HTTP_REQUEST_VALIDATION');
  assert.equal(counts.get('POST'), 1);
});

test('http-request retries a safe network failure but remains inside one deadline', async t => {
  let requests = 0;
  const server = await listen((request, response) => {
    requests += 1;
    if (request.url === '/deadline') {
      text(response, 503, 'retry after deadline');
      return;
    }
    if (requests === 1) {
      request.socket.destroy();
      return;
    }
    json(response, 200, { recovered: true });
  });
  t.after(server.close);

  const recovered = await execute({
    url: server.url,
    responseType: 'json',
    retry: {
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
      backoffFactor: 1,
      jitterRatio: 0,
      respectRetryAfter: false
    }
  }, fixtureOptions());
  assert.equal(recovered.success, true);
  assert.equal(requests, 2);

  const deadline = await execute({
    url: `${server.url}/deadline`,
    timeoutMs: 20,
    retry: {
      maxAttempts: 3,
      statuses: [503],
      initialDelayMs: 50,
      maxDelayMs: 50,
      backoffFactor: 1,
      jitterRatio: 0,
      respectRetryAfter: false
    },
    acceptedStatuses: [201]
  }, fixtureOptions({ timeoutMs: 500 }));
  assertFailure(deadline, 'HTTP_REQUEST_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(deadline), /retry after deadline/);
});

test('http-request returns stable failures for arbitrary transport exceptions', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('exception-secret https://private.example/request provider-body');
  };
  try {
    const result = await execute({
      url: 'https://example.com/resource',
      retry: { maxAttempts: 1 }
    }, { timeoutMs: 100, maxResponseBytes: 100 });
    assertFailure(result, 'HTTP_REQUEST_UPSTREAM');
    assert.doesNotMatch(JSON.stringify(result), /private\.example|provider-body/);
  } finally {
    global.fetch = originalFetch;
  }
});
