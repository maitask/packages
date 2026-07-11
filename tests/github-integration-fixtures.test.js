const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { execute } = require('../github-integration');

function createServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        localhostUrl: `http://localhost:${address.port}`,
        close: () => new Promise(done => {
          server.close(done);
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        })
      });
    });
  });
}

function fixtureOptions(baseUrl, overrides = {}) {
  return {
    baseUrl,
    allowInsecureHttp: true,
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    ...overrides
  };
}

function json(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    connection: 'close',
    ...headers
  });
  response.end(payload);
}

function assertFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
  assert.equal(Object.hasOwn(result.error, 'details'), false);
}

test('github-integration lists public repositories through the formal camelCase contract', async t => {
  let request;
  const server = await createServer((incoming, response) => {
    request = incoming;
    json(response, 200, [{
      id: 42,
      name: 'demo',
      full_name: 'octocat/demo',
      private: false,
      html_url: 'https://github.com/octocat/demo',
      default_branch: 'main',
      stargazers_count: 9,
      topics: ['fixture']
    }], {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '59',
      'x-ratelimit-reset': '1234567890',
      'x-ratelimit-used': '1',
      'x-ratelimit-resource': 'core'
    });
  });
  t.after(() => server.close());

  const result = await execute({
    action: 'listRepositories',
    owner: 'octocat',
    ownerType: 'user',
    perPage: 2,
    page: 1,
    sort: 'updated',
    direction: 'desc'
  }, fixtureOptions(server.url));

  assert.equal(result.success, true);
  assert.equal(request.method, 'GET');
  assert.equal(request.url, '/users/octocat/repos?per_page=2&page=1&sort=updated&direction=desc');
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.accept, 'application/vnd.github+json');
  assert.equal(request.headers['x-github-api-version'], '2022-11-28');
  assert.deepEqual(result.data.items, [{
    index: 0,
    id: '42',
    data: {
      id: 42,
      name: 'demo',
      fullName: 'octocat/demo',
      description: null,
      private: false,
      fork: false,
      archived: false,
      disabled: false,
      htmlUrl: 'https://github.com/octocat/demo',
      cloneUrl: null,
      sshUrl: null,
      language: null,
      forksCount: 0,
      stargazersCount: 9,
      watchersCount: 0,
      size: 0,
      defaultBranch: 'main',
      openIssuesCount: 0,
      topics: ['fixture'],
      license: null,
      createdAt: null,
      updatedAt: null,
      pushedAt: null
    }
  }]);
  assert.deepEqual(result.data.summary, { total: 1, success_count: 1, failure_count: 0 });
  assert.deepEqual(result.metadata.rateLimit, {
    limit: 60,
    remaining: 59,
    reset: 1234567890,
    used: 1,
    resource: 'core'
  });
});

test('github-integration creates an issue once with a context token and never returns the token', async t => {
  const token = 'github-context-token-secret';
  let requests = 0;
  let receivedBody;
  let receivedAuthorization;
  const server = await createServer((request, response) => {
    requests += 1;
    receivedAuthorization = request.headers.authorization;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      receivedBody = JSON.parse(body);
      json(response, 201, {
        id: 7,
        number: 3,
        title: 'Fixture issue',
        body: 'Body',
        state: 'open',
        locked: false,
        labels: [],
        assignees: [],
        comments: 0,
        html_url: 'https://github.com/acme/demo/issues/3'
      });
    });
  });
  t.after(() => server.close());

  const result = await execute({
    action: 'createIssue',
    owner: 'acme',
    repository: 'demo',
    title: 'Fixture issue',
    body: 'Body',
    labels: ['bug']
  }, fixtureOptions(server.url), {
    secrets: { GITHUB_TOKEN: token },
    executionId: 'exec-1'
  });

  assert.equal(result.success, true);
  assert.equal(requests, 1);
  assert.equal(receivedAuthorization, `Bearer ${token}`);
  assert.deepEqual(receivedBody, {
    title: 'Fixture issue',
    body: 'Body',
    labels: ['bug']
  });
  assert.equal(result.metadata.executionId, 'exec-1');
  assert.doesNotMatch(JSON.stringify(result), /github-context-token-secret/);
});

test('github-integration rejects absolute and protocol-relative custom paths before network access', async t => {
  let targetRequests = 0;
  const target = await createServer((_request, response) => {
    targetRequests += 1;
    json(response, 200, { leaked: true });
  });
  let baseRequests = 0;
  const base = await createServer((_request, response) => {
    baseRequests += 1;
    response.end('unexpected');
  });
  t.after(() => Promise.all([target.close(), base.close()]));

  const paths = [
    `${target.url}/steal`,
    `//localhost:${new URL(target.url).port}/steal`,
    '\\\\localhost\\steal',
    '/../admin',
    '/%2e%2e/admin'
  ];
  for (const path of paths) {
    const result = await execute({
      action: 'request',
      method: 'GET',
      path
    }, fixtureOptions(base.url, { token: 'absolute-path-token-secret' }));
    assertFailure(result, 'GITHUB_VALIDATION');
    assert.doesNotMatch(JSON.stringify(result), /absolute-path-token-secret|localhost|steal/);
  }
  assert.equal(targetRequests, 0);
  assert.equal(baseRequests, 0);
});

test('github-integration follows same-origin redirects and retains its managed authorization', async t => {
  const token = 'same-origin-github-token';
  const requests = [];
  let server;
  server = await createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    if (request.url === '/start') {
      response.writeHead(302, { location: `${server.url}/final` });
      response.end();
      return;
    }
    json(response, 200, { ok: true });
  });
  t.after(() => server.close());

  const result = await execute({
    action: 'request',
    method: 'GET',
    path: '/start'
  }, fixtureOptions(server.url, { token }));

  assert.equal(result.success, true);
  assert.deepEqual(requests, [
    { path: '/start', authorization: `Bearer ${token}` },
    { path: '/final', authorization: `Bearer ${token}` }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /same-origin-github-token/);
});

test('github-integration refuses cross-origin redirects without contacting the target', async t => {
  let targetRequests = 0;
  const target = await createServer((_request, response) => {
    targetRequests += 1;
    json(response, 200, { leaked: true });
  });
  const source = await createServer((_request, response) => {
    response.writeHead(307, { location: `${target.localhostUrl}/steal` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute({
    action: 'request',
    method: 'GET',
    path: '/start'
  }, fixtureOptions(source.url, { token: 'redirect-token-secret' }));

  assertFailure(result, 'GITHUB_REDIRECT');
  assert.equal(targetRequests, 0);
  assert.doesNotMatch(JSON.stringify(result), /redirect-token-secret|localhost|steal/);
});

test('github-integration rejects caller attempts to override managed or credential headers', async t => {
  let requests = 0;
  const server = await createServer((_request, response) => {
    requests += 1;
    json(response, 200, {});
  });
  t.after(() => server.close());

  for (const headers of [
    { Authorization: 'Bearer caller-secret' },
    { Host: 'attacker.example' },
    { Cookie: 'session=cookie-secret' },
    { 'X-GitHub-Api-Version': 'attacker-version' },
    { 'X-Test': 'safe\r\nX-Injected: yes' }
  ]) {
    const result = await execute({
      action: 'request',
      method: 'GET',
      path: '/repos/acme/demo',
      headers
    }, fixtureOptions(server.url, { token: 'managed-token-secret' }));
    assertFailure(result, 'GITHUB_VALIDATION');
  }
  assert.equal(requests, 0);
});

test('github-integration normalizes an allowed custom Accept header without duplicating defaults', async t => {
  let receivedAccept;
  let receivedAuthorization;
  const server = await createServer((request, response) => {
    receivedAccept = request.headers.accept;
    receivedAuthorization = request.headers.authorization;
    json(response, 200, { ok: true });
  });
  t.after(() => server.close());

  const result = await execute({
    action: 'request',
    method: 'GET',
    path: '/repos/acme/demo',
    headers: {
      accept: 'application/vnd.github.raw+json',
      'X-Trace-Id': 'trace-1'
    }
  }, fixtureOptions(server.url, { token: 'accept-token-secret' }));

  assert.equal(result.success, true);
  assert.equal(receivedAccept, 'application/vnd.github.raw+json');
  assert.equal(receivedAuthorization, 'Bearer accept-token-secret');
  assert.doesNotMatch(JSON.stringify(result), /accept-token-secret/);
});

test('github-integration rejects read bodies and unauthenticated custom writes before fetch', async t => {
  let requests = 0;
  const server = await createServer((_request, response) => {
    requests += 1;
    json(response, 200, {});
  });
  t.after(() => server.close());

  const readBody = await execute({
    action: 'request',
    method: 'GET',
    path: '/repos/acme/demo',
    body: { unexpected: true }
  }, fixtureOptions(server.url));
  const anonymousWrite = await execute({
    action: 'request',
    method: 'POST',
    path: '/repos/acme/demo/issues',
    body: { title: 'Issue' }
  }, fixtureOptions(server.url));

  assertFailure(readBody, 'GITHUB_VALIDATION');
  assertFailure(anonymousWrite, 'GITHUB_VALIDATION');
  assert.equal(requests, 0);
});

test('github-integration rejects accessors symbols custom prototypes unknown fields and legacy names', async t => {
  let requests = 0;
  const server = await createServer((_request, response) => {
    requests += 1;
    json(response, 200, {});
  });
  t.after(() => server.close());
  let accessorReads = 0;
  const accessorInput = { action: 'getUser' };
  Object.defineProperty(accessorInput, 'username', {
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'secret-user';
    }
  });
  const symbolInput = { action: 'getUser', username: 'octocat' };
  symbolInput[Symbol('secret')] = true;
  const customPrototype = Object.create({ inherited: true });
  customPrototype.action = 'getUser';
  customPrototype.username = 'octocat';

  const cases = [
    accessorInput,
    symbolInput,
    customPrototype,
    { action: 'getUser', username: 'octocat', unexpected: true },
    { action: 'getUser', user_name: 'octocat' },
    { action: 'get-user', username: 'octocat' },
    { operation: 'users.get', username: 'octocat' }
  ];
  for (const input of cases) {
    const result = await execute(input, fixtureOptions(server.url));
    assertFailure(result, 'GITHUB_VALIDATION');
    assert.doesNotMatch(JSON.stringify(result), /secret-user|octocat|users\.get/);
  }
  assert.equal(accessorReads, 0);
  assert.equal(requests, 0);
});

test('github-integration enforces timeout and response byte limits', async t => {
  const slow = await createServer((_request, response) => {
    setTimeout(() => json(response, 200, { secret: 'late-provider-secret' }), 150);
  });
  const large = await createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    response.end(JSON.stringify({ data: 'x'.repeat(256) }));
  });
  const slowBody = await createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    response.write('{"value":');
    setTimeout(() => response.end('1}'), 150);
  });
  t.after(() => Promise.all([slow.close(), large.close(), slowBody.close()]));

  const timeout = await execute({ action: 'getUser', username: 'octocat' }, fixtureOptions(slow.url, {
    timeoutMs: 25
  }));
  const oversized = await execute({ action: 'getUser', username: 'octocat' }, fixtureOptions(large.url, {
    maxResponseBytes: 32
  }));
  const bodyTimeout = await execute({ action: 'getUser', username: 'octocat' }, fixtureOptions(slowBody.url, {
    timeoutMs: 25
  }));

  assertFailure(timeout, 'GITHUB_TIMEOUT');
  assertFailure(oversized, 'GITHUB_RESPONSE_TOO_LARGE');
  assertFailure(bodyTimeout, 'GITHUB_TIMEOUT');
  assert.doesNotMatch(JSON.stringify([timeout, oversized, bodyTimeout]), /late-provider-secret|127\.0\.0\.1/);
});

test('github-integration returns fixed secret-safe provider and transport failures', async t => {
  const token = 'provider-error-token-secret';
  const server = await createServer((_request, response) => {
    json(response, 403, {
      message: `Bearer ${token} rejected at https://api.github.com/private`,
      documentation_url: 'https://docs.github.com/private'
    }, {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1234567890',
      'x-ratelimit-used': '5000',
      'x-ratelimit-resource': 'core'
    });
  });
  t.after(() => server.close());

  const providerFailure = await execute({
    action: 'getUser',
    username: 'octocat'
  }, fixtureOptions(server.url, { token }));
  assertFailure(providerFailure, 'GITHUB_API');
  assert.equal(providerFailure.error.status, 403);
  assert.deepEqual(providerFailure.metadata.rateLimit, {
    limit: 5000,
    remaining: 0,
    reset: 1234567890,
    used: 5000,
    resource: 'core'
  });
  assert.doesNotMatch(JSON.stringify(providerFailure), /provider-error-token-secret|api\.github\.com|docs\.github\.com|private/);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Bearer arbitrary-fetch-secret at https://api.github.com/private');
  };
  try {
    const transportFailure = await execute({ action: 'getUser', username: 'octocat' });
    assertFailure(transportFailure, 'GITHUB_UPSTREAM');
    assert.doesNotMatch(JSON.stringify(transportFailure), /arbitrary-fetch-secret|api\.github\.com|private/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('github-integration supports the complete built-in repository issue pull-request and user action matrix', async t => {
  const requests = [];
  const server = await createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : null });
      if (request.url === '/repos/acme/demo') {
        json(response, 200, { id: 1, name: 'demo', full_name: 'acme/demo' });
      } else if (request.url.startsWith('/repos/acme/demo/issues?')) {
        json(response, 200, [{ id: 2, number: 4, title: 'Issue', state: 'open', labels: [], assignees: [] }]);
      } else if (request.url.startsWith('/repos/acme/demo/pulls?')) {
        json(response, 200, [{ id: 3, number: 5, title: 'Pull', state: 'open' }]);
      } else if (request.url === '/repos/acme/demo/pulls/5' && request.method === 'GET') {
        json(response, 200, { id: 3, number: 5, title: 'Pull', state: 'open' });
      } else if (request.url === '/repos/acme/demo/pulls' && request.method === 'POST') {
        json(response, 201, { id: 4, number: 6, title: 'Create pull', state: 'open' });
      } else if (request.url === '/users/octocat') {
        json(response, 200, { id: 5, login: 'octocat', public_repos: 8 });
      } else {
        json(response, 404, { message: 'unexpected fixture route' });
      }
    });
  });
  t.after(() => server.close());
  const options = fixtureOptions(server.url, { token: 'matrix-token-secret' });

  const results = await Promise.all([
    execute({ action: 'getRepository', owner: 'acme', repository: 'demo' }, options),
    execute({
      action: 'listIssues',
      owner: 'acme',
      repository: 'demo',
      state: 'open',
      sort: 'created',
      direction: 'desc',
      perPage: 10,
      page: 1
    }, options),
    execute({
      action: 'listPullRequests',
      owner: 'acme',
      repository: 'demo',
      state: 'open',
      sort: 'created',
      direction: 'desc',
      perPage: 10,
      page: 1
    }, options),
    execute({ action: 'getPullRequest', owner: 'acme', repository: 'demo', pullNumber: 5 }, options),
    execute({
      action: 'createPullRequest',
      owner: 'acme',
      repository: 'demo',
      title: 'Create pull',
      head: 'feature',
      base: 'main',
      body: 'Ready',
      draft: false
    }, options),
    execute({ action: 'getUser', username: 'octocat' }, options)
  ]);

  assert.equal(results.every(result => result.success), true);
  assert.equal(results[0].data.items[0].data.fullName, 'acme/demo');
  assert.equal(results[1].data.items[0].data.number, 4);
  assert.equal(results[2].data.items[0].data.number, 5);
  assert.equal(results[3].data.items[0].data.title, 'Pull');
  assert.equal(results[4].data.items[0].data.number, 6);
  assert.equal(results[5].data.items[0].data.publicRepositories, 8);
  const createRequest = requests.find(item => item.method === 'POST');
  assert.deepEqual(createRequest.body, {
    title: 'Create pull',
    head: 'feature',
    base: 'main',
    body: 'Ready',
    draft: false
  });
  assert.doesNotMatch(JSON.stringify(results), /matrix-token-secret/);
});
