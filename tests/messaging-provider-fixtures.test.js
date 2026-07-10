const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeKafka } = require('../kafka-publisher');
const { execute: executeSlack } = require('../slack-notifier');
const { execute: executeTelegram } = require('../telegram-bot');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;

function replaceFetch(t, implementation) {
  const previousFetch = global.fetch;
  global.fetch = implementation;
  t.after(() => {
    global.fetch = previousFetch;
  });
}

function forbidFetch(t) {
  const state = { calls: 0 };
  replaceFetch(t, async () => {
    state.calls += 1;
    throw new Error('fetch must not be called');
  });
  return state;
}

test.before(() => {
  global.fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error(`Messaging provider fixture attempted external access: ${target.origin}`);
    }
    return nativeFetch(url, init);
  };
});

test.after(() => {
  global.fetch = nativeFetch;
});

test('telegram sends text through a controlled Bot API endpoint', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-1001',
      text: 'deployment complete',
      parse_mode: 'HTML',
      disable_notification: true
    });
    return {
      body: {
        ok: true,
        result: {
          message_id: 42,
          chat: { id: -1001, title: 'Operations' },
          text: 'deployment complete',
          unknown_field: 'must not escape'
        }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { text: 'deployment complete' },
    {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-1001',
      parseMode: 'HTML',
      disableNotification: true
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 42,
    chatId: -1001,
    text: 'deployment complete'
  });
  assert.equal(Object.hasOwn(result, 'message_id'), false);
  assert.equal(Object.hasOwn(result, 'chat_id'), false);
  assert.doesNotMatch(JSON.stringify(result.data), /message_id|chat_id|unknown_field|Operations/);
  assert.equal(result.metadata.method, 'sendMessage');
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram applies formal defaults to text delivery', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-100-default',
      text: 'default delivery',
      parse_mode: 'Markdown',
      disable_notification: false
    });
    return {
      body: {
        ok: true,
        result: { message_id: 46, chat: { id: -1007 }, text: 'default delivery' }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram('default delivery', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-100-default'
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 46,
    chatId: -1007,
    text: 'default delivery'
  });
});

test('telegram sends a photo from task content without mutating the input', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendPhoto');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-1002',
      photo: 'https://fixtures.example/release.png',
      caption: 'release dashboard',
      parse_mode: 'MarkdownV2',
      disable_notification: false
    });
    return {
      body: {
        ok: true,
        result: { message_id: 43, chat: { id: -1002 }, caption: 'release dashboard' }
      }
    };
  });
  t.after(() => server.close());

  const input = {
    fileUrl: 'https://fixtures.example/release.png',
    caption: 'release dashboard'
  };
  const originalInput = structuredClone(input);
  const result = await executeTelegram(input, {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-1002',
    messageType: 'photo',
    parseMode: 'MarkdownV2'
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 43,
    chatId: -1002,
    caption: 'release dashboard'
  });
  assert.equal(result.metadata.method, 'sendPhoto');
  assert.deepEqual(input, originalInput);
});

test('telegram sends a document and falls back to task text for its caption', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendDocument');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-1003',
      document: 'https://fixtures.example/report.pdf',
      caption: 'quarterly report',
      parse_mode: 'Markdown',
      disable_notification: false
    });
    return {
      body: {
        ok: true,
        result: { message_id: 44, chat: { id: -1003 }, caption: 'quarterly report' }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { fileUrl: 'https://fixtures.example/report.pdf', text: 'quarterly report' },
    {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-1003',
      messageType: 'document'
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 44,
    chatId: -1003,
    caption: 'quarterly report'
  });
  assert.equal(result.metadata.method, 'sendDocument');
});

test('telegram returns a structured API failure through the Runtime endpoint fallback', async t => {
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.headers['content-type'], 'application/json');
    return { status: 400, body: { ok: false, description: 'chat not found' } };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { text: 'delivery failure' },
    { botToken: 'fixture-token', chatId: 'missing-chat' },
    { env: { TELEGRAM_API_BASE_URL: `${server.url}/telegram` } }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.match(result.error.message, /400.*chat not found/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram sanitizes provider descriptions that echo request secrets and URLs', async t => {
  const botToken = '123456:ABC_def-ghi';
  const fileUrl = 'https://media.example/private-release.png';
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, `/telegram/bot${encodeURIComponent(botToken)}/sendPhoto`);
    assert.equal(request.method, 'POST');
    return {
      status: 400,
      body: {
        ok: false,
        description: [
          'delivery rejected',
          `${server.url}/telegram/bot${botToken}/sendPhoto`,
          encodeURIComponent(botToken),
          botToken.replace(':', '%3a'),
          fileUrl,
          'ftp://archive.example/private-release.png'
        ].join(' ')
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    { fileUrl, caption: 'private release' },
    {
      baseUrl: `${server.url}/telegram`,
      botToken,
      chatId: '-100-secret',
      messageType: 'photo'
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.status, 400);
  assert.match(result.error.message, /delivery rejected/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /[a-z][a-z0-9+.-]*:\/\/|123456:ABC_def-ghi|123456%3AABC_def-ghi|123456%3aABC_def-ghi|media\.example|archive\.example/i
  );
});

test('telegram exposes secret-safe retry details for rate limits', async t => {
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    return {
      status: 429,
      body: {
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 7 }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    'retry later',
    {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-1004'
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.status, 429);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details?.retryAfterSeconds, 7);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram rejects malformed successful response envelopes', async t => {
  const envelopes = [{}, [], true, { ok: true }, { ok: true, result: [] }];
  let requestIndex = 0;
  const server = await createFixtureServer(() => ({ body: envelopes[requestIndex++] }));
  t.after(() => server.close());

  for (const envelope of envelopes) {
    const result = await executeTelegram('malformed response', {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-100-envelope'
    });

    assert.equal(result.success, false, `accepted malformed envelope ${JSON.stringify(envelope)}`);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, /response/i);
  }
});

test('telegram rejects malformed known fields in successful results', async t => {
  const validResult = {
    message_id: 49,
    chat: { id: -1010 },
    text: 'validated result'
  };
  const invalidResults = [
    { ...validResult, message_id: {} },
    { ...validResult, message_id: [] },
    { ...validResult, message_id: '49' },
    { ...validResult, message_id: 0 },
    { ...validResult, message_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...validResult, chat: [] },
    { ...validResult, chat: null },
    { ...validResult, chat: {} },
    { ...validResult, chat: { id: '-1010' } },
    { ...validResult, chat: { id: Number.MAX_SAFE_INTEGER + 1 } },
    { ...validResult, text: {} },
    { message_id: 49, chat: { id: -1010 }, caption: [] }
  ];
  let requestIndex = 0;
  const server = await createFixtureServer(() => ({
    body: { ok: true, result: invalidResults[requestIndex++] }
  }));
  t.after(() => server.close());

  for (const invalidResult of invalidResults) {
    const result = await executeTelegram('validate provider result', {
      baseUrl: `${server.url}/telegram`,
      botToken: 'fixture-token',
      chatId: '-1010'
    });

    assert.equal(
      result.success,
      false,
      `accepted malformed result ${JSON.stringify(invalidResult)}`
    );
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, /malformed response/i);
    assert.doesNotMatch(JSON.stringify(result), /fixture-token|https?:\/\//);
  }
});

test('telegram uses an HTTP-200 API error code for retry classification', async t => {
  const server = await createFixtureServer(() => ({
    body: {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 7 }
    }
  }));
  t.after(() => server.close());

  const result = await executeTelegram('retry classified response', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-100-envelope'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.status, 429);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details?.retryAfterSeconds, 7);
});

test('telegram ignores non-integer retry-after values', async t => {
  const server = await createFixtureServer(() => ({
    status: 429,
    body: {
      ok: false,
      description: 'Too Many Requests',
      parameters: { retry_after: '7' }
    }
  }));
  t.after(() => server.close());

  const result = await executeTelegram('invalid retry metadata', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-100-envelope'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.status, 429);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details, undefined);
});

test('telegram structures non-JSON responses as provider errors', async t => {
  const server = await createFixtureServer(() => ({
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'not json'
  }));
  t.after(() => server.close());

  const result = await executeTelegram('non-json response', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-100-envelope'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.status, 200);
  assert.equal(result.error.retriable, false);
  assert.match(result.error.message, /non-JSON/);
});

test('telegram marks server errors retriable without retrying the POST', async t => {
  let requests = 0;
  const server = await createFixtureServer(() => {
    requests += 1;
    return {
      status: 503,
      body: { ok: false, description: 'upstream unavailable' }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram('server failure', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-100-envelope'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.status, 503);
  assert.equal(result.error.retriable, true);
  assert.equal(requests, 1);
});

test('telegram rejects a non-http base URL without calling fetch', async t => {
  const fetchState = forbidFetch(t);

  const result = await executeTelegram('invalid endpoint', {
    baseUrl: 'file:///tmp/telegram',
    botToken: 'fixture-token',
    chatId: '-1005'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.type, 'TelegramBotError');
  assert.match(result.error.message, /base URL.*HTTP/i);
  assert.equal(fetchState.calls, 0);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram rejects base URLs with credentials, search, or hash without calling fetch', async t => {
  const fetchState = forbidFetch(t);

  for (const baseUrl of [
    'https://user:password@api.telegram.test',
    'https://api.telegram.test/root?environment=production',
    'https://api.telegram.test/root#fragment'
  ]) {
    const result = await executeTelegram('invalid endpoint', {
      baseUrl,
      botToken: 'fixture-token',
      chatId: '-1005'
    });

    assert.equal(result.success, false);
    assert.match(result.error.message, /base URL/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects bot tokens that can alter the request target', async t => {
  const fetchState = forbidFetch(t);

  for (const botToken of ['bad/token', 'bad?token', 'bad#token', 'bad token', 'bad%2Ftoken']) {
    const result = await executeTelegram('invalid token', {
      baseUrl: 'https://api.telegram.test',
      botToken,
      chatId: '-1005'
    });

    assert.equal(result.success, false);
    assert.match(result.error.message, /botToken/);
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects invalid options and context containers before fetch', async t => {
  const fetchState = forbidFetch(t);

  const validOptions = {
    baseUrl: 'https://api.telegram.test',
    botToken: 'fixture-token',
    chatId: '-100-container'
  };
  const cases = [
    { options: null, context: {}, field: 'options' },
    { options: [], context: {}, field: 'options' },
    { options: validOptions, context: null, field: 'context' },
    { options: validOptions, context: [], field: 'context' },
    { options: validOptions, context: { secrets: null }, field: 'context.secrets' },
    { options: validOptions, context: { env: [] }, field: 'context.env' }
  ];

  for (const testCase of cases) {
    const result = await executeTelegram('invalid container', testCase.options, testCase.context);
    assert.equal(result.success, false);
    assert.match(result.error.message, new RegExp(`${testCase.field}.*plain object`, 'i'));
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects non-number and non-positive timeout values before fetch', async t => {
  const fetchState = forbidFetch(t);

  for (const timeoutMs of [true, '20', Number.POSITIVE_INFINITY, Number.NaN, 0, -1]) {
    const result = await executeTelegram('invalid timeout', {
      baseUrl: 'https://api.telegram.test',
      botToken: 'fixture-token',
      chatId: '-100-timeout',
      timeoutMs
    });

    assert.equal(result.success, false);
    assert.match(result.error.message, /timeoutMs.*positive number/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram clamps timeout scheduling to 120000 milliseconds', async t => {
  const guardedSetTimeout = global.setTimeout;
  const guardedClearTimeout = global.clearTimeout;
  let scheduledTimeoutMs;
  let clearedTimeoutId;

  global.setTimeout = (_callback, timeoutMs) => {
    scheduledTimeoutMs = timeoutMs;
    return 12345;
  };
  global.clearTimeout = timeoutId => {
    clearedTimeoutId = timeoutId;
  };
  replaceFetch(t, async (_url, init) => {
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          result: { message_id: 48, chat: { id: -1009 }, text: 'clamped timeout' }
        })
    };
  });
  t.after(() => {
    global.setTimeout = guardedSetTimeout;
    global.clearTimeout = guardedClearTimeout;
  });

  const result = await executeTelegram('clamped timeout', {
    baseUrl: 'https://api.telegram.test',
    botToken: 'fixture-token',
    chatId: '-1009',
    timeoutMs: 300000
  });

  assert.equal(result.success, true);
  assert.equal(scheduledTimeoutMs, 120000);
  assert.equal(clearedTimeoutId, 12345);
});

test('telegram does not treat null critical options as absent', async t => {
  const fetchState = forbidFetch(t);

  const cases = [
    {
      options: {
        baseUrl: 'https://api.telegram.test',
        botToken: 'fixture-token',
        chatId: '-100-null',
        messageType: null
      },
      context: {},
      field: 'messageType'
    },
    {
      options: { baseUrl: null, botToken: 'fixture-token', chatId: '-100-null' },
      context: { env: { TELEGRAM_API_BASE_URL: 'https://fallback.telegram.test' } },
      field: 'baseUrl'
    },
    {
      options: {
        baseUrl: 'https://api.telegram.test',
        botToken: null,
        chatId: '-100-null'
      },
      context: { secrets: { TELEGRAM_BOT_TOKEN: 'fallback-token' } },
      field: 'botToken'
    }
  ];

  for (const testCase of cases) {
    const result = await executeTelegram('null option', testCase.options, testCase.context);
    assert.equal(result.success, false);
    assert.match(result.error.message, new RegExp(testCase.field, 'i'));
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram validates task fields and operational option types before fetch', async t => {
  const fetchState = forbidFetch(t);

  const defaults = {
    baseUrl: 'https://api.telegram.test',
    botToken: 'fixture-token',
    chatId: '-100-types'
  };
  const cases = [
    { input: { text: '   ' }, options: {}, field: 'text' },
    { input: { fileUrl: '   ' }, options: { messageType: 'photo' }, field: 'fileUrl' },
    { input: { text: true }, options: {}, field: 'text' },
    { input: { fileUrl: 'https://media.example/a', caption: 7 }, options: { messageType: 'photo' }, field: 'caption' },
    { input: 'valid', options: { botToken: '   ' }, field: 'botToken' },
    { input: 'valid', options: { chatId: true }, field: 'chatId' },
    { input: 'valid', options: { messageType: 1 }, field: 'messageType' },
    { input: 'valid', options: { parseMode: false }, field: 'parseMode' },
    { input: 'valid', options: { replyToMessageId: '12' }, field: 'replyToMessageId' },
    { input: 'valid', options: { disableNotification: 'true' }, field: 'disableNotification' },
    { input: 'valid', options: { disableWebPagePreview: 1 }, field: 'disableWebPagePreview' },
    { input: 'valid', options: { replyMarkup: [] }, field: 'replyMarkup' },
    { input: 'valid', options: { baseUrl: new URL('https://api.telegram.test') }, field: 'baseUrl' }
  ];

  for (const testCase of cases) {
    const result = await executeTelegram(testCase.input, {
      ...defaults,
      ...testCase.options
    });
    assert.equal(result.success, false);
    assert.match(result.error.message, new RegExp(testCase.field, 'i'));
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram uses the Runtime bot-token secret fallback', async t => {
  const botToken = '123456:runtime_secret';
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, `/telegram/bot${encodeURIComponent(botToken)}/sendMessage`);
    assert.equal(request.method, 'POST');
    assert.equal(JSON.parse(body).text, 'secret fallback');
    return {
      body: {
        ok: true,
        result: { message_id: 47, chat: { id: -1008 }, text: 'secret fallback' }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram(
    'secret fallback',
    { chatId: '-1008' },
    {
      secrets: { TELEGRAM_BOT_TOKEN: botToken },
      env: { TELEGRAM_API_BASE_URL: `${server.url}/telegram` }
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 47,
    chatId: -1008,
    text: 'secret fallback'
  });
  assert.doesNotMatch(JSON.stringify(result), /runtime_secret|123456/);
});

test('telegram refuses POST redirects without contacting the redirected origin', async t => {
  let redirectedRequests = 0;
  const redirectedServer = await createFixtureServer(() => {
    redirectedRequests += 1;
    return {
      body: {
        ok: true,
        result: { message_id: 999, chat: { id: -999 }, text: 'redirected' }
      }
    };
  });
  const redirectingServer = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    return {
      status: 307,
      headers: { location: `${redirectedServer.url}/telegram/botfixture-token/sendMessage` },
      body: ''
    };
  });
  t.after(() => redirectingServer.close());
  t.after(() => redirectedServer.close());

  const result = await executeTelegram('do not redirect', {
    baseUrl: `${redirectingServer.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-1005'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(redirectedRequests, 0);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-token|127\.0\.0\.1|localhost|https?:\/\//
  );
});

test('telegram hides the request URL and bot token when delivery fails', async t => {
  replaceFetch(t, async url => {
    throw new Error(`network failed at ${url}`);
  });

  const result = await executeTelegram('network failure', {
    baseUrl: 'https://telegram-fixture.invalid/api',
    botToken: 'fixture-token',
    chatId: '-1006'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.message, 'Telegram request failed');
  assert.equal(result.error.retriable, true);
  assert.doesNotMatch(JSON.stringify(result), /telegram-fixture\.invalid|fixture-token/);
});

test('telegram returns a retriable structured timeout error', async t => {
  const server = await createFixtureServer(async (url, request) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
    assert.equal(request.method, 'POST');
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      body: {
        ok: true,
        result: { message_id: 45, chat: { id: -1006 }, text: 'too slow' }
      }
    };
  });
  t.after(() => server.close());

  const result = await executeTelegram('too slow', {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-1006',
    timeoutMs: 20
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.type, 'TelegramBotError');
  assert.match(result.error.message, /timed out/i);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details?.timeoutMs, 20);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('slack sends the formal webhook payload and masks the result URL', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/services/T000/B000/fixture-secret');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(body), {
      text: 'release complete',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Success*' } }],
      thread_ts: '1700000000.000001',
      username: 'Release Bot',
      icon_emoji: ':rocket:',
      link_names: false,
      mrkdwn: true
    });
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  t.after(() => server.close());

  const result = await executeSlack(
    {
      text: 'release complete',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Success*' } }]
    },
    {
      webhookUrl: `${server.url}/services/T000/B000/fixture-secret`,
      threadTs: '1700000000.000001',
      username: 'Release Bot',
      iconEmoji: ':rocket:',
      linkNames: false,
      mrkdwn: true
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    webhook: `${server.url}/services/T***/B***/***`,
    username: 'Release Bot',
    icon: ':rocket:',
    hasBlocks: true,
    hasAttachments: false,
    threadTs: '1700000000.000001'
  });
  assert.equal(result.metadata.package, '@maitask/slack-notifier');
  assert.equal(result.metadata.provider, 'slack');
  assert.equal(Object.hasOwn(result.metadata, 'response_status'), false);
  assert.equal(Object.hasOwn(result.metadata, 'response_time_ms'), false);
  assert.equal(Object.hasOwn(result.data, 'has_blocks'), false);
  assert.equal(Object.hasOwn(result.data, 'thread_ts'), false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});

test('slack returns a retriable secret-safe structured webhook failure', async t => {
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/services/T111/B111/fixture-secret');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    return {
      status: 429,
      headers: { 'content-type': 'text/plain', 'retry-after': '3' },
      body: 'rate_limited'
    };
  });
  t.after(() => server.close());

  const result = await executeSlack(
    { text: 'retry later' },
    { webhookUrl: `${server.url}/services/T111/B111/fixture-secret` }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.equal(result.error.status, 429);
  assert.match(result.error.message, /429.*rate_limited/);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details?.retryAfterSeconds, 3);
  assert.equal(result.metadata.webhook, `${server.url}/services/T***/B***/***`);
  assert.doesNotMatch(JSON.stringify(result), /T111|B111|fixture-secret/);
});

test('slack classifies provider statuses without retrying a failed POST', async t => {
  const responses = [
    { status: 503, body: 'upstream unavailable', retriable: true },
    { status: 408, body: 'request timeout', retriable: true },
    { status: 425, body: 'too early', retriable: true },
    { status: 400, body: 'invalid_payload', retriable: false },
    { status: 200, body: 'accepted later', retriable: false }
  ];
  let requests = 0;
  const server = await createFixtureServer(() => {
    const response = responses[requests++];
    return {
      status: response.status,
      headers: { 'content-type': 'text/plain' },
      body: response.body
    };
  });
  t.after(() => server.close());

  for (const expected of responses) {
    const before = requests;
    const result = await executeSlack('classified failure', {
      webhookUrl: `${server.url}/services/T300/B300/status-secret`
    });

    assert.equal(result.success, false);
    assert.equal(result.error.status, expected.status);
    assert.equal(result.error.retriable, expected.retriable);
    assert.match(result.error.message, new RegExp(expected.body.replace(' ', '.*'), 'i'));
    assert.equal(requests, before + 1);
    assert.equal(result.error.details, undefined);
  }
});

test('slack ignores malformed Retry-After values', async t => {
  const retryAfterValues = ['0', '-1', '1.5', ' 3 ', 'three', '9007199254740992'];
  let requestIndex = 0;
  const server = await createFixtureServer(() => ({
    status: 429,
    headers: {
      'content-type': 'text/plain',
      'retry-after': retryAfterValues[requestIndex++]
    },
    body: 'rate_limited'
  }));
  t.after(() => server.close());

  for (const retryAfter of retryAfterValues) {
    const result = await executeSlack('invalid retry metadata', {
      webhookUrl: `${server.url}/services/T301/B301/retry-secret`
    });
    assert.equal(result.success, false, `accepted Retry-After ${retryAfter}`);
    assert.equal(result.error.status, 429);
    assert.equal(result.error.retriable, true);
    assert.equal(result.error.details, undefined);
  }
});

test('slack sanitizes provider text that echoes webhook secrets and arbitrary URLs', async t => {
  const team = 'TSECRET300';
  const bot = 'BSECRET300';
  const token = 'token:value_300';
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, `/services/${team}/${bot}/${token}`);
    assert.equal(request.method, 'POST');
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: [
        'delivery rejected',
        `${server.url}/services/${team}/${bot}/${token}`,
        team,
        bot,
        token,
        encodeURIComponent(token),
        'https://media.example/private.png',
        'ftp://archive.example/private.txt'
      ].join(' ')
    };
  });
  t.after(() => server.close());

  const result = await executeSlack('secret-safe error', {
    webhookUrl: `${server.url}/services/${team}/${bot}/${token}`
  });

  assert.equal(result.success, false);
  assert.match(result.error.message, /delivery rejected/);
  assert.doesNotMatch(
    JSON.stringify(result.error),
    /[a-z][a-z0-9+.-]*:\/\/|TSECRET300|BSECRET300|token:value_300|token%3Avalue_300/i
  );
  assert.doesNotMatch(JSON.stringify(result), /TSECRET300|BSECRET300|token:value_300|token%3Avalue_300/i);
});

test('slack returns a secret-safe retriable network failure', async t => {
  replaceFetch(t, async url => {
    throw new Error(`socket failed at ${url} via https://diagnostics.example/private`);
  });

  const result = await executeSlack('network failure', {
    webhookUrl: 'https://hooks.slack.test/services/T302/B302/network-secret'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.message, 'Slack request failed');
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.equal(result.error.type, 'SlackNotificationError');
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.status, undefined);
  assert.doesNotMatch(JSON.stringify(result), /T302|B302|network-secret|diagnostics\.example/);
});

test('slack returns a structured timeout failure', async t => {
  const server = await createFixtureServer(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  t.after(() => server.close());

  const result = await executeSlack('too slow', {
    webhookUrl: `${server.url}/services/T303/B303/timeout-secret`,
    timeoutMs: 20
  });

  assert.equal(result.success, false);
  assert.match(result.error.message, /timed out/i);
  assert.equal(result.error.retriable, true);
  assert.deepEqual(result.error.details, { timeoutMs: 20 });
  assert.doesNotMatch(JSON.stringify(result), /T303|B303|timeout-secret/);
});

test('slack uses the default timeout and clamps excessive timeout scheduling', async t => {
  const guardedSetTimeout = global.setTimeout;
  const guardedClearTimeout = global.clearTimeout;
  const scheduledTimeouts = [];
  const clearedTimeouts = [];
  let nextTimerId = 700;

  global.setTimeout = (_callback, timeoutMs) => {
    scheduledTimeouts.push(timeoutMs);
    return nextTimerId++;
  };
  global.clearTimeout = timeoutId => {
    clearedTimeouts.push(timeoutId);
  };
  replaceFetch(t, async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: true, status: 200, text: async () => 'ok' };
  });
  t.after(() => {
    global.setTimeout = guardedSetTimeout;
    global.clearTimeout = guardedClearTimeout;
  });

  const defaultResult = await executeSlack('default timeout', {
    webhookUrl: 'https://hooks.slack.test/services/T304/B304/default-secret'
  });
  const clampedResult = await executeSlack('clamped timeout', {
    webhookUrl: 'https://hooks.slack.test/services/T305/B305/clamped-secret',
    timeoutMs: 300000
  });

  assert.equal(defaultResult.success, true);
  assert.equal(clampedResult.success, true);
  assert.deepEqual(scheduledTimeouts, [30000, 120000]);
  assert.deepEqual(clearedTimeouts, [700, 701]);
});

test('slack refuses POST redirects without contacting the redirected origin', async t => {
  let redirectedRequests = 0;
  const redirectedServer = await createFixtureServer(() => {
    redirectedRequests += 1;
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  const redirectingServer = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/services/T306/B306/redirect-secret');
    assert.equal(request.method, 'POST');
    return {
      status: 307,
      headers: { location: `${redirectedServer.url}/services/T999/B999/stolen-secret` },
      body: 'redirecting'
    };
  });
  t.after(() => redirectingServer.close());
  t.after(() => redirectedServer.close());

  const result = await executeSlack('do not redirect', {
    webhookUrl: `${redirectingServer.url}/services/T306/B306/redirect-secret`
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.equal(result.error.retriable, true);
  assert.equal(redirectedRequests, 0);
  assert.doesNotMatch(JSON.stringify(result), /T306|B306|redirect-secret|T999|B999|stolen-secret/);
});

test('slack applies formal defaults to string task content through a context secret', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/services/T200/B200/context-secret');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(body), {
      text: 'context delivery',
      username: 'Maitask Bot',
      icon_emoji: ':robot_face:',
      link_names: true,
      mrkdwn: true
    });
    return { headers: { 'content-type': 'text/plain' }, body: ' OK\n' };
  });
  t.after(() => server.close());

  const result = await executeSlack(
    'context delivery',
    {},
    { secrets: { SLACK_WEBHOOK_URL: `${server.url}/services/T200/B200/context-secret/` } }
  );

  assert.deepEqual(result.data, {
    webhook: `${server.url}/services/T***/B***/***`,
    username: 'Maitask Bot',
    icon: ':robot_face:',
    hasBlocks: false,
    hasAttachments: false
  });
  assert.equal(result.metadata.package, '@maitask/slack-notifier');
  assert.equal(result.metadata.version, '0.1.0');
  assert.equal(result.metadata.provider, 'slack');
  assert.equal(result.metadata.responseStatus, 200);
  assert.equal(typeof result.metadata.responseTimeMs, 'number');
  assert.match(result.metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(result), /context-secret|T200|B200/);
});

test('slack sends blocks and attachments without mutating task or runtime inputs', async t => {
  const server = await createFixtureServer((_url, _request, body) => {
    assert.deepEqual(JSON.parse(body), {
      text: 'fallback',
      blocks: [{ type: 'divider' }],
      attachments: [{ color: '#00ff00', text: 'details' }],
      channel: '#releases',
      username: 'Maitask Bot',
      icon_url: 'https://assets.example/slack.png',
      link_names: true,
      mrkdwn: false
    });
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  t.after(() => server.close());

  const input = {
    text: 'fallback',
    blocks: [{ type: 'divider' }],
    attachments: [{ color: '#00ff00', text: 'details' }]
  };
  const options = {
    webhookUrl: `${server.url}/services/T201/B201/input-secret`,
    channel: '#releases',
    iconUrl: 'https://assets.example/slack.png',
    mrkdwn: false
  };
  const context = { secrets: { UNUSED: 'unchanged' } };
  const originals = [structuredClone(input), structuredClone(options), structuredClone(context)];

  const result = await executeSlack(input, options, context);

  assert.equal(result.success, true);
  assert.equal(result.data.channel, '#releases');
  assert.equal(Object.hasOwn(result.data, 'icon'), false);
  assert.equal(result.data.hasBlocks, true);
  assert.equal(result.data.hasAttachments, true);
  assert.deepEqual([input, options, context], originals);
  assert.doesNotMatch(JSON.stringify(result), /assets\.example|input-secret|T201|B201/);
});

test('slack rejects simultaneous explicit icon settings before fetch', async t => {
  const fetchState = forbidFetch(t);
  const result = await executeSlack('conflicting icon', {
    webhookUrl: 'https://hooks.slack.test/services/T202/B202/secret',
    iconEmoji: ':rocket:',
    iconUrl: 'https://assets.example/slack.png'
  });

  assert.equal(result.success, false);
  assert.match(result.error.message, /iconEmoji.*iconUrl|iconUrl.*iconEmoji/i);
  assert.equal(fetchState.calls, 0);
  assert.doesNotMatch(JSON.stringify(result), /T202|B202|secret|assets\.example/);
});

test('slack rejects invalid endpoint forms and explicit null without secret fallback', async t => {
  const fetchState = forbidFetch(t);
  const invalidWebhookUrls = [
    '   ',
    'file:///tmp/slack',
    'https://user:password@hooks.slack.test/services/T/B/token',
    'https://hooks.slack.test/services/T/B/token?debug=true',
    'https://hooks.slack.test/services/T/B/token#fragment',
    'https://hooks.slack.test/'
  ];

  for (const webhookUrl of invalidWebhookUrls) {
    const result = await executeSlack('invalid webhook', { webhookUrl });
    assert.equal(result.success, false);
    assert.match(result.error.message, /webhookUrl/i);
  }

  const explicitNull = await executeSlack(
    'no fallback',
    { webhookUrl: null },
    { secrets: { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/services/T/B/fallback' } }
  );
  assert.equal(explicitNull.success, false);
  assert.match(explicitNull.error.message, /webhookUrl/i);
  assert.equal(fetchState.calls, 0);
});

test('slack rejects invalid containers, content, and option types before fetch', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T203/B203/secret';
  const cases = [
    { input: [], options: { webhookUrl }, context: {}, field: 'input' },
    { input: 'valid', options: null, context: {}, field: 'options' },
    { input: 'valid', options: [], context: {}, field: 'options' },
    { input: 'valid', options: { webhookUrl }, context: null, field: 'context' },
    { input: 'valid', options: { webhookUrl }, context: [], field: 'context' },
    {
      input: 'valid',
      options: { webhookUrl },
      context: { secrets: [] },
      field: 'context.secrets'
    },
    { input: { text: 7 }, options: { webhookUrl }, context: {}, field: 'text' },
    { input: { blocks: [] }, options: { webhookUrl }, context: {}, field: 'blocks' },
    { input: { blocks: ['invalid'] }, options: { webhookUrl }, context: {}, field: 'blocks' },
    { input: { attachments: [] }, options: { webhookUrl }, context: {}, field: 'attachments' },
    {
      input: { attachments: [null] },
      options: { webhookUrl },
      context: {},
      field: 'attachments'
    },
    { input: 'valid', options: { webhookUrl, threadTs: 7 }, context: {}, field: 'threadTs' },
    { input: 'valid', options: { webhookUrl, channel: false }, context: {}, field: 'channel' },
    { input: 'valid', options: { webhookUrl, username: [] }, context: {}, field: 'username' },
    { input: 'valid', options: { webhookUrl, iconEmoji: 1 }, context: {}, field: 'iconEmoji' },
    { input: 'valid', options: { webhookUrl, iconUrl: {} }, context: {}, field: 'iconUrl' },
    { input: 'valid', options: { webhookUrl, linkNames: 1 }, context: {}, field: 'linkNames' },
    { input: 'valid', options: { webhookUrl, mrkdwn: 'false' }, context: {}, field: 'mrkdwn' },
    { input: 'valid', options: { webhookUrl, timeoutMs: true }, context: {}, field: 'timeoutMs' },
    { input: 'valid', options: { webhookUrl, timeoutMs: Infinity }, context: {}, field: 'timeoutMs' },
    { input: 'valid', options: { webhookUrl, timeoutMs: 0 }, context: {}, field: 'timeoutMs' }
  ];

  for (const testCase of cases) {
    const result = await executeSlack(testCase.input, testCase.options, testCase.context);
    assert.equal(result.success, false, `accepted invalid ${testCase.field}`);
    assert.match(result.error.message, new RegExp(testCase.field, 'i'));
  }

  for (const input of ['', '   ', {}, { text: ' \n ' }, { message: 'legacy task content' }]) {
    const result = await executeSlack(input, { webhookUrl });
    assert.equal(result.success, false, `accepted empty or legacy input ${JSON.stringify(input)}`);
    assert.match(result.error.message, /content|text|blocks|attachments/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('slack does not read task content or legacy aliases from options', async t => {
  const fetchState = forbidFetch(t);
  const formalWebhook = 'https://hooks.slack.test/services/T204/B204/formal-secret';

  const contentInOptions = await executeSlack({}, {
    webhookUrl: formalWebhook,
    text: 'must not become task content',
    blocks: [{ type: 'divider' }],
    attachments: [{ text: 'legacy' }]
  });
  assert.equal(contentInOptions.success, false);
  assert.match(contentInOptions.error.message, /content|text|blocks|attachments/i);

  const messageAlias = await executeSlack({ message: 'legacy alias' }, {
    webhookUrl: formalWebhook
  });
  assert.equal(messageAlias.success, false);

  const legacyOnly = await executeSlack('legacy endpoint', {
    webhook_url: 'https://hooks.slack.test/services/T205/B205/legacy-secret',
    thread_ts: '1700000000.1',
    icon_emoji: ':old:',
    icon_url: 'https://assets.example/old.png',
    link_names: false
  });
  assert.equal(legacyOnly.success, false);
  assert.match(legacyOnly.error.message, /webhookUrl/i);
  assert.equal(fetchState.calls, 0);
});

test('kafka publishes records through a controlled REST proxy', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/topics/production-events');
    assert.equal(request.headers.authorization, 'Bearer fixture-kafka');
    assert.equal(request.headers['content-type'], 'application/vnd.kafka.json.v2+json');
    assert.deepEqual(JSON.parse(body), {
      records: [
        { key: 'release', value: 'deployed' },
        { key: 'release', value: '{"version":"1.2.3"}' }
      ]
    });
    return {
      body: {
        offsets: [
          { partition: 0, offset: 101 },
          { partition: 0, offset: 102 }
        ]
      }
    };
  });
  t.after(() => server.close());

  const result = await executeKafka({
    proxyUrl: server.url,
    topic: 'production-events',
    key: 'release',
    messages: ['deployed', { version: '1.2.3' }],
    headers: { Authorization: 'Bearer fixture-kafka' }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.count, 2);
  assert.deepEqual(result.data.offsets, [
    { partition: 0, offset: 101 },
    { partition: 0, offset: 102 }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-kafka/);
});

test('kafka returns a structured REST proxy failure', async t => {
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, '/topics/production-events');
    assert.equal(request.headers.authorization, 'Bearer fixture-kafka');
    return {
      status: 503,
      body: { error_code: 50003, message: 'broker unavailable' }
    };
  });
  t.after(() => server.close());

  const result = await executeKafka({
    proxyUrl: server.url,
    topic: 'production-events',
    messages: ['event'],
    headers: { Authorization: 'Bearer fixture-kafka' }
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
  assert.equal(result.error.type, 'KafkaPublisherError');
  assert.equal(result.error.message, 'broker unavailable');
  assert.doesNotMatch(JSON.stringify(result), /fixture-kafka/);
});
