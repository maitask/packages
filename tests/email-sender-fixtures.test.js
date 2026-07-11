const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');

const { execute } = require('../email-sender');

const SECRET_PATTERN = /sendgrid-secret|mailgun-secret|mutated-secret|exception-secret/i;

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
    'content-type': 'application/json',
    'content-length': String(body.byteLength),
    ...headers
  });
  response.end(body);
}

function sendGridOptions(baseUrl, overrides = {}) {
  return {
    baseUrl,
    allowInsecureHttp: true,
    apiKeySecret: 'SENDGRID_API_KEY',
    timeoutMs: 2_000,
    maxResponseBytes: 64 * 1024,
    secrets: { SENDGRID_API_KEY: 'sendgrid-secret' },
    ...overrides
  };
}

function mailgunOptions(baseUrl, overrides = {}) {
  return {
    baseUrl,
    allowInsecureHttp: true,
    domain: 'mg.example.com',
    apiKeySecret: 'MAILGUN_API_KEY',
    timeoutMs: 2_000,
    maxResponseBytes: 64 * 1024,
    secrets: { MAILGUN_API_KEY: 'mailgun-secret' },
    ...overrides
  };
}

function baseInput(provider) {
  return {
    provider,
    from: { email: 'sender@example.com', name: 'Maitask Sender' },
    to: [{ email: 'recipient@example.com', name: 'Primary Recipient' }],
    subject: 'Production notification',
    content: { text: 'Production text' }
  };
}

function assertFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
  assert.equal(result.metadata.package, '@maitask/email-sender');
  assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
}

function receipt(result) {
  assert.equal(result.success, true);
  assert.equal(result.data.items.length, 1);
  return result.data.items[0].data;
}

test('email-sender sends the complete SendGrid JSON contract once', async t => {
  let observed;
  const server = await listen(async (request, response) => {
    observed = {
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body: JSON.parse((await readRequest(request)).toString('utf8'))
    };
    response.writeHead(202, {
      'x-message-id': 'sendgrid-message-1',
      'content-length': '0'
    });
    response.end();
  });
  t.after(server.close);

  const result = await execute({
    provider: 'sendgrid',
    from: { email: 'sender@example.com', name: 'Maitask Sender' },
    to: [{ email: 'to@example.com', name: 'To Recipient' }],
    cc: [{ email: 'cc@example.com', name: 'CC Recipient' }],
    bcc: [{ email: 'bcc@example.com' }],
    replyTo: { email: 'reply@example.com', name: 'Support' },
    subject: 'Production notification',
    content: { text: 'Plain body', html: '<p>HTML body</p>' },
    headers: { 'X-Trace-Id': 'trace-1' },
    tags: ['production', 'notifications'],
    metadata: { workflowId: 'workflow-1' },
    attachments: [{
      filename: 'report.bin',
      contentType: 'application/octet-stream',
      bodyBase64: 'AP9B',
      disposition: 'attachment'
    }, {
      filename: 'logo.png',
      contentType: 'image/png',
      bodyBase64: 'iVBORw==',
      disposition: 'inline',
      contentId: 'logo-1'
    }]
  }, sendGridOptions(server.url), { executionId: 'execution-1' });

  assert.equal(result.success, true);
  assert.deepEqual(observed, {
    method: 'POST',
    path: '/v3/mail/send',
    authorization: 'Bearer sendgrid-secret',
    contentType: 'application/json; charset=utf-8',
    body: {
      personalizations: [{
        to: [{ email: 'to@example.com', name: 'To Recipient' }],
        cc: [{ email: 'cc@example.com', name: 'CC Recipient' }],
        bcc: [{ email: 'bcc@example.com' }],
        headers: { 'X-Trace-Id': 'trace-1' },
        custom_args: { workflowId: 'workflow-1' }
      }],
      from: { email: 'sender@example.com', name: 'Maitask Sender' },
      reply_to: { email: 'reply@example.com', name: 'Support' },
      subject: 'Production notification',
      content: [
        { type: 'text/plain', value: 'Plain body' },
        { type: 'text/html', value: '<p>HTML body</p>' }
      ],
      attachments: [{
        content: 'AP9B',
        filename: 'report.bin',
        type: 'application/octet-stream',
        disposition: 'attachment'
      }, {
        content: 'iVBORw==',
        filename: 'logo.png',
        type: 'image/png',
        disposition: 'inline',
        content_id: 'logo-1'
      }],
      categories: ['production', 'notifications']
    }
  });
  assert.deepEqual(receipt(result), {
    provider: 'sendgrid',
    messageId: 'sendgrid-message-1',
    status: 202,
    recipientCount: 3,
    hasText: true,
    hasHtml: true,
    attachmentCount: 2,
    templateMode: 'none'
  });
  assert.equal(result.metadata.executionId, 'execution-1');
  assert.doesNotMatch(JSON.stringify(result), /sendgrid-secret|to@example|cc@example|bcc@example|Production notification|Plain body/);
});

test('email-sender sends complete Mailgun multipart bytes through the formal endpoint', async t => {
  let observed;
  const server = await listen(async (request, response) => {
    observed = {
      path: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body: await readRequest(request)
    };
    json(response, 200, { id: '<mailgun-message-1@example.com>', message: 'Queued. Thank you.' });
  });
  t.after(server.close);

  const result = await execute({
    provider: 'mailgun',
    from: { email: 'sender@example.com', name: 'Maitask Sender' },
    to: [{ email: 'to@example.com', name: 'To Recipient' }],
    cc: [{ email: 'cc@example.com' }],
    bcc: [{ email: 'bcc@example.com' }],
    replyTo: { email: 'reply@example.com' },
    subject: 'Mailgun notification',
    content: { text: 'Mailgun text', html: '<p>Mailgun HTML</p>' },
    headers: { 'X-Trace-Id': 'trace-mailgun' },
    tags: ['production', 'mailgun'],
    metadata: { workflowId: 'workflow-2' },
    attachments: [{
      filename: 'artifact.bin',
      contentType: 'application/octet-stream',
      bodyBase64: 'AP+AQQ=='
    }]
  }, mailgunOptions(server.url));

  assert.equal(result.success, true);
  assert.equal(observed.path, '/v3/mg.example.com/messages');
  assert.equal(observed.authorization, `Basic ${Buffer.from('api:mailgun-secret').toString('base64')}`);
  assert.match(observed.contentType, /^multipart\/form-data; boundary=maitask-/);
  const bodyText = observed.body.toString('latin1');
  for (const expected of [
    'name="from"', 'Maitask Sender', 'sender@example.com',
    'name="to"', 'to@example.com', 'name="cc"', 'cc@example.com',
    'name="bcc"', 'bcc@example.com', 'name="h:Reply-To"', 'reply@example.com',
    'name="subject"', 'Mailgun notification', 'name="text"', 'Mailgun text',
    'name="html"', '<p>Mailgun HTML</p>', 'name="h:X-Trace-Id"', 'trace-mailgun',
    'name="o:tag"', 'production', 'mailgun', 'name="v:workflowId"', 'workflow-2',
    'name="attachment"', 'filename="artifact.bin"', 'Content-Type: application/octet-stream'
  ]) assert.match(bodyText, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.equal(observed.body.includes(Buffer.from([0, 255, 128, 65])), true);
  assert.equal(receipt(result).messageId, '<mailgun-message-1@example.com>');
  assert.equal(receipt(result).recipientCount, 3);
  assert.doesNotMatch(JSON.stringify(result), /mailgun-secret|to@example|Mailgun notification|Mailgun text/);
});

test('email-sender renders local templates with strict paths and HTML escaping', async t => {
  let payload;
  const server = await listen(async (request, response) => {
    payload = JSON.parse((await readRequest(request)).toString('utf8'));
    response.writeHead(202, { 'content-length': '0' });
    response.end();
  });
  t.after(server.close);

  const result = await execute({
    provider: 'sendgrid',
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    subject: 'Template delivery',
    template: {
      text: 'Hello {{ user.name }}, count={{count}}',
      html: '<p>Hello {{user.name}}, note={{note}}</p>',
      variables: {
        user: { name: 'A&B' },
        count: 3,
        note: '<script>alert("x")</script>'
      }
    }
  }, sendGridOptions(server.url));

  assert.equal(result.success, true);
  assert.deepEqual(payload.content, [
    { type: 'text/plain', value: 'Hello A&B, count=3' },
    {
      type: 'text/html',
      value: '<p>Hello A&amp;B, note=&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>'
    }
  ]);
  assert.equal(receipt(result).templateMode, 'local');

  const unresolved = await execute({
    provider: 'sendgrid',
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    subject: 'Invalid template',
    template: { text: 'Missing {{value}}', variables: {} }
  }, sendGridOptions(server.url));
  assertFailure(unresolved, 'EMAIL_VALIDATION');

  const malformed = await execute({
    provider: 'sendgrid',
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    subject: 'Invalid template syntax',
    template: { text: 'Malformed {{invalid-key}}', variables: { 'invalid-key': 'value' } }
  }, sendGridOptions(server.url));
  assertFailure(malformed, 'EMAIL_VALIDATION');
});

test('email-sender maps provider-native templates for SendGrid and Mailgun', async t => {
  const requests = [];
  const server = await listen(async (request, response) => {
    const body = await readRequest(request);
    requests.push({ path: request.url, contentType: request.headers['content-type'], body });
    if (request.url.startsWith('/v3/mail/send')) {
      response.writeHead(202, { 'x-message-id': 'template-sendgrid', 'content-length': '0' });
      response.end();
      return;
    }
    json(response, 200, { id: 'template-mailgun' });
  });
  t.after(server.close);

  const sendgrid = await execute({
    provider: 'sendgrid',
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    providerTemplate: { id: 'd-template-1', variables: { name: 'Maitask', count: 2 } }
  }, sendGridOptions(server.url));
  const mailgun = await execute({
    provider: 'mailgun',
    from: { email: 'sender@example.com' },
    to: [{ email: 'recipient@example.com' }],
    providerTemplate: { id: 'production-template', variables: { name: 'Maitask', count: 2 } }
  }, mailgunOptions(server.url));

  assert.equal(sendgrid.success, true);
  assert.equal(mailgun.success, true);
  const sendGridPayload = JSON.parse(requests[0].body.toString('utf8'));
  assert.equal(sendGridPayload.template_id, 'd-template-1');
  assert.deepEqual(sendGridPayload.personalizations[0].dynamic_template_data, { name: 'Maitask', count: 2 });
  assert.equal(sendGridPayload.subject, undefined);
  assert.equal(sendGridPayload.content, undefined);
  const mailgunBody = requests[1].body.toString('utf8');
  assert.match(mailgunBody, /name="template"\r\n\r\nproduction-template/);
  assert.match(mailgunBody, /name="h:X-Mailgun-Variables"\r\n\r\n\{"name":"Maitask","count":2\}/);
  assert.equal(receipt(sendgrid).templateMode, 'provider');
  assert.equal(receipt(mailgun).templateMode, 'provider');
});

test('email-sender rejects legacy, behavioral, inherited, symbolic, cyclic, and unknown data before contact', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const accessor = {};
  Object.defineProperty(accessor, 'provider', { enumerable: true, get() { throw new Error('accessed'); } });
  const symbolic = baseInput('sendgrid');
  symbolic[Symbol('hidden')] = true;
  const inherited = Object.create({ provider: 'sendgrid' });
  inherited.from = { email: 'sender@example.com' };
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const cases = [
    accessor,
    symbolic,
    inherited,
    { ...baseInput('sendgrid'), api_key: 'literal-secret' },
    { ...baseInput('sendgrid'), smtp_config: { host: 'smtp.example.com' } },
    { ...baseInput('smtp') },
    { ...baseInput('sendgrid'), template_data: {} },
    { ...baseInput('sendgrid'), unknown: true },
    { ...baseInput('sendgrid'), metadata: cyclic },
    { ...baseInput('sendgrid'), to: sparse },
    { ...baseInput('sendgrid'), content: Object.create({ text: 'inherited' }) },
    { ...baseInput('sendgrid'), content: { text: 'one' }, template: { text: 'two', variables: {} } }
  ];
  for (const input of cases) {
    const result = await execute(input, sendGridOptions(server.url));
    assertFailure(result, 'EMAIL_VALIDATION');
  }
  assert.equal(requests, 0);
});

test('email-sender rejects missing credentials, invalid addresses, duplicates, injected headers, and invalid attachments', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const missing = await execute(baseInput('sendgrid'), sendGridOptions(server.url, { secrets: {} }));
  assertFailure(missing, 'EMAIL_SECRET_UNAVAILABLE');

  const cases = [
    { ...baseInput('sendgrid'), to: [{ email: 'invalid address' }] },
    { ...baseInput('sendgrid'), cc: [{ email: 'RECIPIENT@example.com' }] },
    { ...baseInput('sendgrid'), subject: 'Subject\r\nBcc: attacker@example.com' },
    { ...baseInput('sendgrid'), headers: { Subject: 'override' } },
    { ...baseInput('sendgrid'), headers: { 'X-Test': 'safe\r\nInjected: yes' } },
    { ...baseInput('sendgrid'), attachments: [{ filename: 'bad.bin', contentType: 'application/octet-stream', bodyBase64: 'AB==' }] },
    { ...baseInput('sendgrid'), attachments: [{ filename: 'inline.png', contentType: 'image/png', bodyBase64: 'AA==', disposition: 'inline' }] }
  ];
  for (const input of cases) {
    const result = await execute(input, sendGridOptions(server.url));
    assertFailure(result, 'EMAIL_VALIDATION');
  }

  const mailgunInline = await execute({
    ...baseInput('mailgun'),
    attachments: [{
      filename: 'logo.png',
      contentType: 'image/png',
      bodyBase64: 'AA==',
      disposition: 'inline',
      contentId: 'different-content-id'
    }]
  }, mailgunOptions(server.url));
  assertFailure(mailgunInline, 'EMAIL_VALIDATION');
  assert.equal(requests, 0);
});

test('email-sender rejects provider endpoint and trusted option policy violations before contact', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'baseUrl', {
    enumerable: true,
    get() { throw new Error('accessed'); }
  });
  const cases = [
    [baseInput('sendgrid'), { baseUrl: server.url, secrets: { SENDGRID_API_KEY: 'sendgrid-secret' } }],
    [baseInput('sendgrid'), sendGridOptions(`${server.url}/path`)],
    [baseInput('sendgrid'), sendGridOptions(`http://user:password@127.0.0.1:${new URL(server.url).port}`)],
    [baseInput('sendgrid'), sendGridOptions(server.url, { domain: 'mg.example.com' })],
    [baseInput('mailgun'), { baseUrl: server.url, allowInsecureHttp: true, secrets: { MAILGUN_API_KEY: 'mailgun-secret' } }],
    [baseInput('sendgrid'), { ...sendGridOptions(server.url), unknown: true }],
    [baseInput('sendgrid'), accessorOptions]
  ];
  for (const [input, options] of cases) {
    const result = await execute(input, options);
    assert.equal(result.success, false);
    assert.match(result.error.code, /^EMAIL_(?:VALIDATION|POLICY)$/);
  }
  assert.equal(requests, 0);
});

test('email-sender snapshots recipients, content, attachments, and secrets before transport', async t => {
  let payload;
  const server = await listen(async (request, response) => {
    payload = JSON.parse((await readRequest(request)).toString('utf8'));
    response.writeHead(202, { 'content-length': '0' });
    response.end();
  });
  t.after(server.close);

  const input = {
    provider: 'sendgrid',
    from: { email: 'sender@example.com' },
    to: [{ email: 'original@example.com' }],
    subject: 'Original subject',
    content: { text: 'Original body' },
    attachments: [{ filename: 'original.bin', contentType: 'application/octet-stream', bodyBase64: 'AA==' }]
  };
  const options = sendGridOptions(server.url);
  const promise = execute(input, options);
  input.to[0].email = 'mutated@example.com';
  input.content.text = 'Mutated body';
  input.attachments[0].bodyBase64 = '/w==';
  options.secrets.SENDGRID_API_KEY = 'mutated-secret';

  const result = await promise;
  assert.equal(result.success, true);
  assert.deepEqual(payload.personalizations[0].to, [{ email: 'original@example.com' }]);
  assert.deepEqual(payload.content, [{ type: 'text/plain', value: 'Original body' }]);
  assert.equal(payload.attachments[0].content, 'AA==');
  assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
});

test('email-sender rejects provider redirects without contacting the target or replaying POST', async t => {
  let sourceRequests = 0;
  let targetRequests = 0;
  const target = await listen((_request, response) => {
    targetRequests += 1;
    response.end();
  });
  const source = await listen((request, response) => {
    sourceRequests += 1;
    request.resume();
    response.writeHead(307, { location: `${target.url}/steal` });
    response.end();
  });
  t.after(() => Promise.all([source.close(), target.close()]));

  const result = await execute(baseInput('sendgrid'), sendGridOptions(source.url));
  assertFailure(result, 'EMAIL_REDIRECT');
  assert.equal(sourceRequests, 1);
  assert.equal(targetRequests, 0);
});

test('email-sender reports provider failures as retriable without replaying the delivery', async t => {
  let requests = 0;
  const server = await listen((request, response) => {
    requests += 1;
    request.resume();
    json(response, 503, {
      error: 'sendgrid-secret recipient@example.com https://private.example provider-body'
    });
  });
  t.after(server.close);

  const result = await execute(baseInput('sendgrid'), sendGridOptions(server.url));
  assertFailure(result, 'EMAIL_PROVIDER');
  assert.equal(result.error.status, 503);
  assert.equal(result.error.retriable, true);
  assert.equal(requests, 1);
  assert.doesNotMatch(JSON.stringify(result), /recipient@example|private\.example|provider-body/);
});

test('email-sender enforces the total response deadline and response byte ceiling', async t => {
  const slowServer = await listen((request, response) => {
    request.resume();
    response.writeHead(202, { 'content-type': 'text/plain' });
    response.write('start');
    setTimeout(() => response.end('-finish'), 100);
  });
  const largeServer = await listen((request, response) => {
    request.resume();
    response.writeHead(202, { 'content-type': 'text/plain' });
    response.end('123456789');
  });
  t.after(() => Promise.all([slowServer.close(), largeServer.close()]));

  const slow = await execute(baseInput('sendgrid'), sendGridOptions(slowServer.url, { timeoutMs: 25 }));
  assertFailure(slow, 'EMAIL_TIMEOUT');

  const large = await execute(baseInput('sendgrid'), sendGridOptions(largeServer.url, { maxResponseBytes: 8 }));
  assertFailure(large, 'EMAIL_RESPONSE_TOO_LARGE');
});

test('email-sender sends Mailgun multipart through canonical Runtime bodyBase64', async () => {
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
            headers: { 'content-type': 'application/json' },
            bodyBase64: Buffer.from(JSON.stringify({ id: 'runtime-mailgun' })).toString('base64'),
            bodyBytes: Buffer.byteLength(JSON.stringify({ id: 'runtime-mailgun' }))
          };
        }
      }
    }
  };
  try {
    const result = await execute(baseInput('mailgun'), {
      domain: 'mg.example.com',
      apiKeySecret: 'MAILGUN_API_KEY',
      secrets: { MAILGUN_API_KEY: 'mailgun-secret' }
    });
    assert.equal(result.success, true);
    assert.equal(observed.url, 'https://api.mailgun.net/v3/mg.example.com/messages');
    assert.equal(typeof observed.request.bodyBase64, 'string');
    assert.equal(observed.request.body, undefined);
    assert.equal(observed.request.redirect, 'manual');
    const multipart = Buffer.from(observed.request.bodyBase64, 'base64').toString('utf8');
    assert.match(multipart, /name="text"\r\n\r\nProduction text/);
    assert.doesNotMatch(JSON.stringify(result), SECRET_PATTERN);
  } finally {
    if (originalDeno === undefined) delete global.Deno;
    else global.Deno = originalDeno;
  }
});

test('email-sender normalizes arbitrary transport exceptions without inspecting or exposing them', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error('exception-secret recipient@example.com https://private.example provider-body');
  };
  try {
    const result = await execute(baseInput('sendgrid'), {
      secrets: { SENDGRID_API_KEY: 'sendgrid-secret' },
      timeoutMs: 100,
      maxResponseBytes: 1024
    });
    assertFailure(result, 'EMAIL_UPSTREAM');
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /recipient@example|private\.example|provider-body/);
  } finally {
    global.fetch = originalFetch;
  }
});
