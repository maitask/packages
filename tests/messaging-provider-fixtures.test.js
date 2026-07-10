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

test('telegram rejects unknown and legacy task-content fields before fetch', async t => {
  const fetchState = forbidFetch(t);
  const invalidFields = [
    ['chat_id', '-100-legacy'],
    ['file_url', 'https://media.example/legacy.png'],
    ['unknown', true]
  ];

  for (const [field, value] of invalidFields) {
    const result = await executeTelegram(
      { text: 'valid formal content', [field]: value },
      {
        baseUrl: 'https://telegram-options.example/api',
        botToken: 'fixture-token',
        chatId: '-100-allowlist'
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, new RegExp(`input.*${field}`, 'i'));
    assert.equal(result.metadata.package, '@maitask/telegram-bot');
    assert.equal(result.metadata.provider, 'telegram');
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture-token|telegram-options\.example|https?:\/\//
    );
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects unknown and legacy operational options before fetch', async t => {
  const fetchState = forbidFetch(t);
  const invalidOptions = [
    ['bot_token', 'legacy-token'],
    ['chat_id', '-100-legacy'],
    ['message_type', 'text'],
    ['parse_mode', 'HTML'],
    ['reply_to_message_id', 12],
    ['disable_notification', true],
    ['disable_web_page_preview', true],
    ['reply_markup', {}],
    ['file_url', 'https://media.example/legacy.png'],
    ['caption', 'legacy caption'],
    ['text', 'legacy text'],
    ['timeout', 1000],
    ['unknown', true]
  ];

  for (const [field, value] of invalidOptions) {
    const result = await executeTelegram('valid formal content', {
      baseUrl: 'https://telegram-options.example/api',
      botToken: 'fixture-token',
      chatId: '-100-allowlist',
      [field]: value
    });

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, new RegExp(`options.*${field}`, 'i'));
    assert.equal(result.metadata.package, '@maitask/telegram-bot');
    assert.equal(result.metadata.provider, 'telegram');
    assert.doesNotMatch(
      JSON.stringify(result),
      /fixture-token|telegram-options\.example|https?:\/\//
    );
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects parse modes outside the formal enum before fetch', async t => {
  const fetchState = forbidFetch(t);

  for (const parseMode of ['PlainText', 'markdown', null, '', '   ', 42]) {
    const result = await executeTelegram('valid formal content', {
      baseUrl: 'https://telegram-options.example/api',
      botToken: 'fixture-token',
      chatId: '-100-allowlist',
      parseMode
    });

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, /parseMode.*Markdown.*MarkdownV2.*HTML/i);
    assert.equal(result.metadata.package, '@maitask/telegram-bot');
    assert.equal(result.metadata.provider, 'telegram');
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects public accessors without invoking getters', async t => {
  const fetchState = forbidFetch(t);
  const validOptions = {
    baseUrl: 'https://telegram-accessor.example/api',
    botToken: 'fixture-token',
    chatId: '-100-accessor'
  };
  const cases = [
    {
      field: 'input.text',
      create(counter) {
        const input = {};
        Object.defineProperty(input, 'text', {
          enumerable: true,
          get() {
            counter.calls += 1;
            return 'accessor content';
          }
        });
        return { input, options: validOptions, context: {} };
      }
    },
    ...['botToken', 'chatId', 'parseMode'].map(field => ({
      field: `options.${field}`,
      create(counter) {
        const options = { ...validOptions };
        delete options[field];
        Object.defineProperty(options, field, {
          enumerable: true,
          get() {
            counter.calls += 1;
            if (field === 'botToken') {
              throw new Error('throwing-getter-secret');
            }
            return field === 'chatId' ? '-100-accessor' : 'HTML';
          }
        });
        return { input: 'accessor content', options, context: {} };
      }
    })),
    {
      field: 'context.secrets',
      create(counter) {
        const context = {};
        Object.defineProperty(context, 'secrets', {
          enumerable: true,
          get() {
            counter.calls += 1;
            return { TELEGRAM_BOT_TOKEN: 'fixture-token' };
          }
        });
        return {
          input: 'accessor content',
          options: { baseUrl: validOptions.baseUrl, chatId: validOptions.chatId },
          context
        };
      }
    },
    {
      field: 'context.env',
      create(counter) {
        const context = {};
        Object.defineProperty(context, 'env', {
          enumerable: true,
          get() {
            counter.calls += 1;
            return { TELEGRAM_API_BASE_URL: validOptions.baseUrl };
          }
        });
        return {
          input: 'accessor content',
          options: { botToken: validOptions.botToken, chatId: validOptions.chatId },
          context
        };
      }
    }
  ];

  for (const testCase of cases) {
    const counter = { calls: 0 };
    const invocation = testCase.create(counter);
    const result = await executeTelegram(
      invocation.input,
      invocation.options,
      invocation.context
    );

    assert.equal(result.success, false, `accepted accessor ${testCase.field}`);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.equal(counter.calls, 0, `invoked accessor ${testCase.field}`);
    assert.doesNotMatch(JSON.stringify(result), /throwing-getter-secret|fixture-token|https?:\/\//);
  }

  assert.equal(fetchState.calls, 0);
});

test('telegram rejects symbol keys before fetch', async t => {
  const fetchState = forbidFetch(t);
  const input = { text: 'symbol input', [Symbol()]: 'input-symbol' };
  const options = {
    baseUrl: 'https://telegram-symbol.example/api',
    botToken: 'fixture-token',
    chatId: '-100-symbol',
    [Symbol()]: 'option-symbol'
  };

  const inputResult = await executeTelegram(input, {
    baseUrl: options.baseUrl,
    botToken: options.botToken,
    chatId: options.chatId
  });
  const optionResult = await executeTelegram('symbol options', options);

  assert.equal(inputResult.success, false);
  assert.equal(inputResult.error.code, 'TELEGRAM_ERROR');
  assert.equal(optionResult.success, false);
  assert.equal(optionResult.error.code, 'TELEGRAM_ERROR');
  assert.equal(fetchState.calls, 0);
});

test('telegram hides arbitrary non-provider exception messages', async () => {
  const input = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('proxy-trap-secret https://proxy-secret.example/path');
      }
    }
  );

  const result = await executeTelegram(input, {
    baseUrl: 'https://telegram-proxy.example/api',
    botToken: 'fixture-token',
    chatId: '-100-proxy'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.message, 'Telegram request failed');
  assert.doesNotMatch(JSON.stringify(result), /proxy-trap-secret|proxy-secret|fixture-token/);
});

test('telegram rejects unsafe nested reply markup without executing behavior', async t => {
  const fetchState = forbidFetch(t);
  const getterCounter = { calls: 0 };
  const getterButton = {};
  Object.defineProperty(getterButton, 'text', {
    enumerable: true,
    get() {
      getterCounter.calls += 1;
      return 'nested-getter-secret';
    }
  });

  const toJsonCounter = { calls: 0 };
  const toJsonMarkup = {
    inline_keyboard: [],
    toJSON() {
      toJsonCounter.calls += 1;
      return { leaked: 'to-json-secret' };
    }
  };
  const cyclicMarkup = { inline_keyboard: [] };
  cyclicMarkup.self = cyclicMarkup;
  const customButton = Object.create({ inherited: 'custom-prototype-secret' });
  customButton.text = 'custom prototype';
  const sparseRow = [];
  sparseRow.length = 1;

  const cases = [
    { label: 'nested getter', value: { inline_keyboard: [[getterButton]] } },
    { label: 'toJSON function', value: toJsonMarkup },
    { label: 'cycle', value: cyclicMarkup },
    { label: 'custom prototype', value: { inline_keyboard: [[customButton]] } },
    { label: 'array hole', value: { inline_keyboard: [sparseRow] } },
    { label: 'symbol field', value: { inline_keyboard: [], [Symbol()]: true } },
    { label: 'function value', value: { inline_keyboard: [], handler() {} } },
    { label: 'bigint value', value: { inline_keyboard: [], count: 1n } },
    { label: 'undefined value', value: { inline_keyboard: [], extra: undefined } }
  ];

  for (const testCase of cases) {
    const result = await executeTelegram('unsafe reply markup', {
      baseUrl: 'https://telegram-reply-markup.example/api',
      botToken: 'fixture-token',
      chatId: '-100-reply-markup',
      replyMarkup: testCase.value
    });

    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'TELEGRAM_ERROR');
    assert.match(result.error.message, /replyMarkup.*JSON data/i);
    assert.doesNotMatch(
      JSON.stringify(result),
      /nested-getter-secret|to-json-secret|custom-prototype-secret|fixture-token|https?:\/\//
    );
  }

  assert.equal(getterCounter.calls, 0);
  assert.equal(toJsonCounter.calls, 0);
  assert.equal(fetchState.calls, 0);
});

test('telegram copies valid deep reply markup without mutating caller data', async t => {
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: 'approve' },
        { text: 'Documentation', url: 'https://docs.example/release' }
      ]
    ],
    selective: false
  };
  const originalReplyMarkup = structuredClone(replyMarkup);
  const originalStringify = JSON.stringify;
  let observedDetachedCopy = false;
  JSON.stringify = (value, ...args) => {
    if (value?.reply_markup !== undefined) {
      observedDetachedCopy =
        value.reply_markup !== replyMarkup &&
        value.reply_markup.inline_keyboard !== replyMarkup.inline_keyboard &&
        value.reply_markup.inline_keyboard[0] !== replyMarkup.inline_keyboard[0] &&
        value.reply_markup.inline_keyboard[0][0] !== replyMarkup.inline_keyboard[0][0];
    }
    return originalStringify(value, ...args);
  };
  t.after(() => {
    JSON.stringify = originalStringify;
  });

  const server = await createFixtureServer((_url, _request, body) => {
    assert.deepEqual(JSON.parse(body).reply_markup, originalReplyMarkup);
    return {
      body: {
        ok: true,
        result: { message_id: 50, chat: { id: -1011 }, text: 'deep reply markup' }
      }
    };
  });
  t.after(() => server.close());

  const options = {
    baseUrl: `${server.url}/telegram`,
    botToken: 'fixture-token',
    chatId: '-1011',
    replyMarkup
  };
  const originalOptions = { ...options };
  const result = await executeTelegram('deep reply markup', options);

  assert.equal(result.success, true);
  assert.equal(observedDetachedCopy, true);
  assert.deepEqual(replyMarkup, originalReplyMarkup);
  assert.deepEqual(options, originalOptions);
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

  const options = { chatId: '-1008' };
  const context = {
    secrets: { TELEGRAM_BOT_TOKEN: botToken },
    env: { TELEGRAM_API_BASE_URL: `${server.url}/telegram` }
  };
  const originalOptions = structuredClone(options);
  const originalContext = structuredClone(context);
  const result = await executeTelegram('secret fallback', options, context);

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    messageId: 47,
    chatId: -1008,
    text: 'secret fallback'
  });
  assert.doesNotMatch(JSON.stringify(result), /runtime_secret|123456/);
  assert.deepEqual(options, originalOptions);
  assert.deepEqual(context, originalContext);
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
  assert.equal(result.metadata.webhook, `${server.url}/services/T***/B***/***`);
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
    { status: 599, body: 'last server error', retriable: true },
    { status: 600, body: 'outside server range', retriable: false },
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

test('slack normalizes escaped and percent-encoded provider secrets before sanitizing', async t => {
  const secret = 'nonstandard-secret';
  const server = await createFixtureServer((url, request) => {
    assert.equal(url.pathname, `/hooks/${secret}`);
    assert.equal(request.method, 'POST');
    const escapedWebhook = `${server.url}/hooks/${secret}`.replaceAll('/', '\\/');
    return {
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: [
        'delivery rejected',
        escapedWebhook,
        String.raw`https:\/\/media.example\/private.png`,
        'https%3A%2F%2Fencoded.example%2Fprivate.png',
        'h%74tps%3a%2f%2fmixed.example%2Fprivate.png',
        'nonstandard%2Dsecret',
        '%6eonstandard%2dsecret',
        'non%73tandard%252Dsecret',
        '%4EONSTANDARD%2DSECRET',
        'malformed %E0%A4%A'
      ].join(' ')
    };
  });
  t.after(() => server.close());

  const result = await executeSlack('normalize provider error', {
    webhookUrl: `${server.url}/hooks/${secret}`
  });

  assert.equal(result.success, false);
  assert.match(result.error.message, /delivery rejected/);
  assert.equal(result.metadata.webhook, `${server.url}/services/***`);
  assert.doesNotMatch(
    JSON.stringify(result.error),
    /[a-z][a-z0-9+.-]*:\/\/|\\\/|https?%|nonstandard|media\.example|encoded\.example|mixed\.example/i
  );
  assert.doesNotMatch(JSON.stringify(result), /nonstandard(?:-|%25?2d)secret/i);
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
      attachments: [{ color: '#00ff00', text: 'details' }, {}],
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
    attachments: [{ color: '#00ff00', text: 'details' }, {}]
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

test('slack rejects blocks without an own non-blank string type before fetch', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T208/B208/block-secret';
  const inheritedType = Object.create({ type: 'section' });
  inheritedType.text = { type: 'plain_text', text: 'inherited type' };
  let accessorReads = 0;
  const accessorType = {};
  Object.defineProperty(accessorType, 'type', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'section';
    }
  });
  const cases = [
    { label: 'missing type', block: {}, errorPattern: /blocks\[0\]\.type/i },
    { label: 'empty type', block: { type: '' }, errorPattern: /blocks\[0\]\.type/i },
    { label: 'blank type', block: { type: '   ' }, errorPattern: /blocks\[0\]\.type/i },
    { label: 'non-string type', block: { type: 1 }, errorPattern: /blocks\[0\]\.type/i },
    { label: 'accessor type', block: accessorType, errorPattern: /blocks\[0\]\.type/i },
    { label: 'inherited type', block: inheritedType, errorPattern: /blocks\[0\].*plain object/i }
  ];

  for (const testCase of cases) {
    const result = await executeSlack(
      { text: 'valid fallback', blocks: [testCase.block] },
      { webhookUrl }
    );

    assert.equal(result.success, false, `accepted block with ${testCase.label}`);
    assert.equal(result.error.code, 'SLACK_ERROR');
    assert.match(result.error.message, testCase.errorPattern);
    assert.equal(result.metadata.webhook, 'https://hooks.slack.test/services/T***/B***/***');
    assert.doesNotMatch(JSON.stringify(result), /T208|B208|block-secret/);
  }

  assert.equal(fetchState.calls, 0);
  assert.equal(accessorReads, 0);
});

test('slack snapshots public data without invoking input option or secret accessors', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T209/B209/accessor-secret';
  const cases = [
    {
      label: 'input.text getter',
      create: () => {
        let reads = 0;
        const input = {};
        Object.defineProperty(input, 'text', {
          enumerable: true,
          get: () => {
            reads += 1;
            throw new Error('input-getter-private-value');
          }
        });
        return {
          input,
          options: { webhookUrl },
          context: {},
          getReads: () => reads,
          expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
        };
      }
    },
    {
      label: 'options.username getter',
      create: () => {
        let reads = 0;
        const options = { webhookUrl };
        Object.defineProperty(options, 'username', {
          enumerable: true,
          get: () => {
            reads += 1;
            throw new Error('option-getter-private-value');
          }
        });
        return {
          input: { text: 'valid task' },
          options,
          context: {},
          getReads: () => reads,
          expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
        };
      }
    },
    {
      label: 'context.secrets getter',
      create: () => {
        let reads = 0;
        const context = {};
        Object.defineProperty(context, 'secrets', {
          enumerable: true,
          get: () => {
            reads += 1;
            throw new Error('context-getter-private-value');
          }
        });
        return {
          input: { text: 'valid task' },
          options: { webhookUrl },
          context,
          getReads: () => reads,
          expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
        };
      }
    },
    {
      label: 'SLACK_WEBHOOK_URL getter',
      create: () => {
        let reads = 0;
        const secrets = {};
        Object.defineProperty(secrets, 'SLACK_WEBHOOK_URL', {
          enumerable: true,
          get: () => {
            reads += 1;
            throw new Error('secret-getter-private-value');
          }
        });
        return {
          input: { text: 'valid task' },
          options: {},
          context: { secrets },
          getReads: () => reads,
          expectedWebhook: null
        };
      }
    }
  ];

  for (const testCase of cases) {
    const values = testCase.create();
    const result = await executeSlack(values.input, values.options, values.context);

    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'SLACK_ERROR');
    assert.equal(result.error.type, 'SlackNotificationError');
    assert.equal(values.getReads(), 0, `invoked ${testCase.label}`);
    assert.equal(result.metadata.webhook, values.expectedWebhook);
    assert.doesNotMatch(
      JSON.stringify(result),
      /input-getter-private-value|option-getter-private-value|context-getter-private-value|secret-getter-private-value|T209|B209|accessor-secret/
    );
  }

  assert.equal(fetchState.calls, 0);
});

test('slack replaces untrusted thrown errors with a fixed safe message', async t => {
  const fetchState = forbidFetch(t);
  const forgedError = new Error('forged-slack-error-private-value');
  forgedError.code = 'SLACK_ERROR';
  forgedError.type = 'SlackNotificationError';
  const input = new Proxy(
    { text: 'valid task' },
    {
      ownKeys() {
        throw forgedError;
      }
    }
  );

  const result = await executeSlack(input, {
    webhookUrl: 'https://hooks.slack.test/services/T213/B213/forged-secret'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.message, 'Slack notification failed');
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.equal(result.error.type, 'SlackNotificationError');
  assert.equal(result.metadata.webhook, 'https://hooks.slack.test/services/T***/B***/***');
  assert.equal(fetchState.calls, 0);
  assert.doesNotMatch(
    JSON.stringify(result),
    /forged-slack-error-private-value|T213|B213|forged-secret/
  );
});

test('slack rejects symbols and custom prototypes in public data before fetch', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T210/B210/public-secret';
  const symbol = Symbol('private');
  const customInput = Object.create({ inherited: true });
  customInput.text = 'valid task';
  const customOptions = Object.create({ inherited: true });
  customOptions.webhookUrl = webhookUrl;
  const customSecrets = Object.create({ inherited: true });
  customSecrets.SLACK_WEBHOOK_URL = webhookUrl;
  const cases = [
    {
      label: 'input symbol',
      input: { text: 'valid task', [symbol]: 'hidden' },
      options: { webhookUrl },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      label: 'options symbol',
      input: { text: 'valid task' },
      options: { webhookUrl, [symbol]: 'hidden' },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      label: 'secret symbol',
      input: { text: 'valid task' },
      options: {},
      context: { secrets: { SLACK_WEBHOOK_URL: webhookUrl, [symbol]: 'hidden' } },
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      label: 'custom input prototype',
      input: customInput,
      options: { webhookUrl },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      label: 'custom options prototype',
      input: { text: 'valid task' },
      options: customOptions,
      context: {},
      expectedWebhook: null
    },
    {
      label: 'custom secrets prototype',
      input: { text: 'valid task' },
      options: {},
      context: { secrets: customSecrets },
      expectedWebhook: null
    }
  ];

  for (const testCase of cases) {
    const result = await executeSlack(testCase.input, testCase.options, testCase.context);
    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'SLACK_ERROR');
    assert.equal(result.metadata.webhook, testCase.expectedWebhook);
    assert.doesNotMatch(JSON.stringify(result), /T210|B210|public-secret|hidden/);
  }

  assert.equal(fetchState.calls, 0);
});

test('slack rejects behavioral or non-JSON nested message data before fetch', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T211/B211/nested-secret';
  const symbol = Symbol('nested-private');
  const cases = [
    {
      label: 'block getter',
      create: () => {
        let calls = 0;
        const text = {};
        Object.defineProperty(text, 'text', {
          enumerable: true,
          get: () => {
            calls += 1;
            throw new Error('nested-block-getter-secret');
          }
        });
        return {
          input: { text: 'fallback', blocks: [{ type: 'section', text }] },
          getBehaviorCalls: () => calls
        };
      }
    },
    {
      label: 'attachment getter',
      create: () => {
        let calls = 0;
        const attachment = {};
        Object.defineProperty(attachment, 'text', {
          enumerable: true,
          get: () => {
            calls += 1;
            throw new Error('nested-attachment-getter-secret');
          }
        });
        return {
          input: { text: 'fallback', attachments: [attachment] },
          getBehaviorCalls: () => calls
        };
      }
    },
    {
      label: 'toJSON function',
      create: () => {
        let calls = 0;
        const behavior = {
          toJSON() {
            calls += 1;
            return { leaked: 'nested-tojson-secret' };
          }
        };
        return {
          input: { text: 'fallback', blocks: [{ type: 'section', behavior }] },
          getBehaviorCalls: () => calls
        };
      }
    },
    {
      label: 'cycle',
      create: () => {
        const attachment = {};
        attachment.self = attachment;
        return { input: { text: 'fallback', attachments: [attachment] } };
      }
    },
    {
      label: 'custom prototype',
      create: () => ({
        input: {
          text: 'fallback',
          blocks: [{ type: 'section', nested: Object.create({ inherited: true }) }]
        }
      })
    },
    {
      label: 'array hole',
      create: () => ({
        input: { text: 'fallback', blocks: [{ type: 'actions', elements: new Array(1) }] }
      })
    },
    {
      label: 'function',
      create: () => ({
        input: { text: 'fallback', blocks: [{ type: 'section', callback: () => true }] }
      })
    },
    {
      label: 'bigint',
      create: () => ({
        input: { text: 'fallback', attachments: [{ count: 1n }] }
      })
    },
    {
      label: 'undefined',
      create: () => ({
        input: { text: 'fallback', attachments: [{ optional: undefined }] }
      })
    },
    {
      label: 'symbol',
      create: () => ({
        input: { text: 'fallback', blocks: [{ type: 'section', [symbol]: 'hidden' }] }
      })
    }
  ];

  for (const testCase of cases) {
    const values = testCase.create();
    const result = await executeSlack(values.input, { webhookUrl });

    assert.equal(result.success, false, `accepted nested ${testCase.label}`);
    assert.equal(result.error.code, 'SLACK_ERROR');
    assert.equal(result.error.type, 'SlackNotificationError');
    assert.match(result.error.message, /blocks|attachments/i);
    assert.equal(values.getBehaviorCalls?.() || 0, 0, `executed nested ${testCase.label}`);
    assert.equal(result.metadata.webhook, 'https://hooks.slack.test/services/T***/B***/***');
    assert.doesNotMatch(
      JSON.stringify(result),
      /nested-block-getter-secret|nested-attachment-getter-secret|nested-tojson-secret|T211|B211|nested-secret|hidden/
    );
  }

  assert.equal(fetchState.calls, 0);
});

test('slack sends detached deep JSON message data without mutating the source', async t => {
  const expectedPayload = {
    text: 'deep message',
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Deploy complete*' },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Inspect' },
          value: 'inspect-release'
        }
      },
      {
        type: 'context',
        elements: [{ type: 'plain_text', text: 'production' }]
      }
    ],
    attachments: [
      {
        color: '#00ff00',
        fields: [{ title: 'Attempts', value: 1, short: true }],
        details: { approved: true, note: null, ratios: [0.5, 1] }
      }
    ],
    username: 'Maitask Bot',
    icon_emoji: ':robot_face:',
    link_names: true,
    mrkdwn: true
  };
  const server = await createFixtureServer((_url, request, body) => {
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), expectedPayload);
    return { headers: { 'content-type': 'text/plain' }, body: 'ok' };
  });
  t.after(() => server.close());

  const input = {
    text: expectedPayload.text,
    blocks: expectedPayload.blocks,
    attachments: expectedPayload.attachments
  };
  const options = { webhookUrl: `${server.url}/services/T212/B212/deep-secret` };
  const context = { secrets: { UNUSED_SECRET: 'unchanged' } };
  const originals = [structuredClone(input), structuredClone(options), structuredClone(context)];

  const result = await executeSlack(input, options, context);

  assert.equal(result.success, true);
  assert.deepEqual([input, options, context], originals);
  assert.doesNotMatch(JSON.stringify(result), /T212|B212|deep-secret/);
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
    assert.equal(result.metadata.webhook, null);
  }

  const explicitNull = await executeSlack(
    'no fallback',
    { webhookUrl: null },
    { secrets: { SLACK_WEBHOOK_URL: 'https://hooks.slack.test/services/T/B/fallback' } }
  );
  assert.equal(explicitNull.success, false);
  assert.match(explicitNull.error.message, /webhookUrl/i);
  assert.equal(explicitNull.metadata.webhook, null);

  const missingWebhook = await executeSlack('missing webhook');
  assert.equal(missingWebhook.success, false);
  assert.equal(missingWebhook.metadata.webhook, null);
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

  for (const input of ['', '   ', {}, { text: ' \n ' }]) {
    const result = await executeSlack(input, { webhookUrl });
    assert.equal(result.success, false, `accepted empty input ${JSON.stringify(input)}`);
    assert.match(result.error.message, /content|text|blocks|attachments/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('slack rejects every unknown or legacy public field with otherwise valid input', async t => {
  const fetchState = forbidFetch(t);
  const formalWebhook = 'https://hooks.slack.test/services/T204/B204/formal-secret';
  const cases = [
    { container: 'input', key: 'message', value: 'legacy task content' },
    { container: 'input', key: 'webhook_url', value: formalWebhook },
    { container: 'input', key: 'thread_ts', value: '1700000000.1' },
    { container: 'input', key: 'unexpected', value: true },
    { container: 'options', key: 'text', value: 'must not become task content' },
    { container: 'options', key: 'message', value: 'legacy task content' },
    { container: 'options', key: 'blocks', value: [{ type: 'divider' }] },
    { container: 'options', key: 'attachments', value: [{ text: 'legacy' }] },
    { container: 'options', key: 'webhook_url', value: formalWebhook },
    { container: 'options', key: 'thread_ts', value: '1700000000.1' },
    { container: 'options', key: 'icon_emoji', value: ':old:' },
    { container: 'options', key: 'icon_url', value: 'https://assets.example/old.png' },
    { container: 'options', key: 'link_names', value: false },
    { container: 'options', key: 'unexpected', value: true }
  ];

  for (const testCase of cases) {
    const input = { text: 'valid formal task content' };
    const options = { webhookUrl: formalWebhook };
    if (testCase.container === 'input') input[testCase.key] = testCase.value;
    if (testCase.container === 'options') options[testCase.key] = testCase.value;

    const result = await executeSlack(input, options);
    assert.equal(
      result.success,
      false,
      `accepted unknown ${testCase.container}.${testCase.key}`
    );
    assert.equal(result.error.code, 'SLACK_ERROR');
    assert.match(result.error.message, new RegExp(`${testCase.container}\\.${testCase.key}`, 'i'));
    assert.equal(result.metadata.webhook, 'https://hooks.slack.test/services/T***/B***/***');
    assert.doesNotMatch(JSON.stringify(result), /T204|B204|formal-secret/);
  }

  assert.equal(fetchState.calls, 0);
});

test('slack preserves masked webhook metadata for pre-fetch validation failures', async t => {
  const fetchState = forbidFetch(t);
  const webhookUrl = 'https://hooks.slack.test/services/T206/B206/validation-secret';
  const fallbackWebhook = 'https://hooks.slack.test/services/T207/B207/fallback-secret';
  const cases = [
    {
      input: { text: 'icon conflict' },
      options: { webhookUrl, iconEmoji: ':rocket:', iconUrl: 'https://assets.example/icon.png' },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      input: { text: 'invalid type' },
      options: { webhookUrl, linkNames: 'true' },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      input: { text: '   ' },
      options: { webhookUrl },
      context: {},
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    },
    {
      input: { text: 'fallback validation' },
      options: { mrkdwn: 'true' },
      context: { secrets: { SLACK_WEBHOOK_URL: fallbackWebhook } },
      expectedWebhook: 'https://hooks.slack.test/services/T***/B***/***'
    }
  ];

  for (const testCase of cases) {
    const result = await executeSlack(testCase.input, testCase.options, testCase.context);
    assert.equal(result.success, false);
    assert.equal(result.metadata.webhook, testCase.expectedWebhook);
    assert.doesNotMatch(JSON.stringify(result), /T206|B206|validation-secret|T207|B207|fallback-secret/);
  }

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
          { partition: 0, offset: 101, provider_metadata: 'drop' },
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

test('kafka rejects non-plain explicit input and options containers before fetch', async t => {
  const fetchState = forbidFetch(t);
  const validInput = {
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event']
  };
  const customInput = Object.create({ inherited: true });
  Object.assign(customInput, validInput);
  const customOptions = Object.create({ inherited: true });
  customOptions.timeoutMs = 1000;
  const cases = [
    { label: 'missing input', input: undefined, options: undefined },
    { label: 'null input', input: null, options: undefined },
    { label: 'primitive input', input: 'event', options: undefined },
    { label: 'array input', input: [], options: undefined },
    { label: 'custom prototype input', input: customInput, options: undefined },
    { label: 'null options', input: validInput, options: null },
    { label: 'primitive options', input: validInput, options: 'invalid' },
    { label: 'array options', input: validInput, options: [] },
    { label: 'custom prototype options', input: validInput, options: customOptions }
  ];

  for (const testCase of cases) {
    const result = await executeKafka(testCase.input, testCase.options);
    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /(?:input|options).*plain object/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('kafka snapshots input and options data properties without invoking accessors', async t => {
  const fetchState = forbidFetch(t);
  let accessorReads = 0;
  const accessorInput = {
    proxyUrl: 'https://valid-proxy.example',
    messages: ['event']
  };
  Object.defineProperty(accessorInput, 'topic', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'production-events';
    }
  });
  const unknownAccessorInput = {
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event']
  };
  Object.defineProperty(unknownAccessorInput, 'unknown', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'ignored';
    }
  });
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'proxyUrl', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'https://valid-proxy.example';
    }
  });
  const symbolInput = {
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event'],
    [Symbol('input')]: 'invalid'
  };
  const symbolOptions = { [Symbol('options')]: 'invalid' };
  const cases = [
    { label: 'input field accessor', input: accessorInput, options: {} },
    { label: 'unknown input accessor', input: unknownAccessorInput, options: {} },
    {
      label: 'options field accessor',
      input: { topic: 'production-events', messages: ['event'] },
      options: accessorOptions
    },
    { label: 'input symbol', input: symbolInput, options: {} },
    {
      label: 'options symbol',
      input: {
        proxyUrl: 'https://valid-proxy.example',
        topic: 'production-events',
        messages: ['event']
      },
      options: symbolOptions
    }
  ];

  for (const testCase of cases) {
    const result = await executeKafka(testCase.input, testCase.options);
    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
  }

  assert.equal(fetchState.calls, 0);
  assert.equal(accessorReads, 0);
});

test('kafka rejects unsafe recursive message key and header data without callbacks', async t => {
  const fetchState = forbidFetch(t);
  let callbackCalls = 0;
  const accessorMessage = {};
  Object.defineProperty(accessorMessage, 'value', {
    enumerable: true,
    get: () => {
      callbackCalls += 1;
      return 'secret';
    }
  });
  const toJsonMessage = {
    toJSON: () => {
      callbackCalls += 1;
      return { exposed: true };
    }
  };
  const cyclicMessage = {};
  cyclicMessage.self = cyclicMessage;
  const callbackKey = {
    toString: () => {
      callbackCalls += 1;
      return 'unsafe-key';
    }
  };
  const callbackHeader = {
    toString: () => {
      callbackCalls += 1;
      return 'unsafe-header';
    }
  };
  const accessorHeaders = {};
  Object.defineProperty(accessorHeaders, 'X-Unsafe', {
    enumerable: true,
    get: () => {
      callbackCalls += 1;
      return 'unsafe-header';
    }
  });
  const sparseMessages = [];
  sparseMessages[1] = 'event';
  const customArrayMessages = ['event'];
  Object.setPrototypeOf(customArrayMessages, Object.create(Array.prototype));
  const customMessage = Object.create({ inherited: true });
  customMessage.event = 'release';
  const symbolMessage = { event: 'release', [Symbol('nested')]: 'invalid' };
  const base = {
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events'
  };
  const cases = [
    { label: 'nested message accessor', input: { ...base, messages: [accessorMessage] } },
    { label: 'message toJSON', input: { ...base, messages: [toJsonMessage] } },
    { label: 'cyclic message', input: { ...base, messages: [cyclicMessage] } },
    { label: 'callback key', input: { ...base, messages: ['event'], key: callbackKey } },
    {
      label: 'callback header',
      input: { ...base, messages: ['event'], headers: { 'X-Unsafe': callbackHeader } }
    },
    { label: 'header accessor', input: { ...base, messages: ['event'], headers: accessorHeaders } },
    { label: 'sparse messages', input: { ...base, messages: sparseMessages } },
    { label: 'custom array prototype', input: { ...base, messages: customArrayMessages } },
    { label: 'undefined message', input: { ...base, messages: ['event', undefined] } },
    { label: 'function message', input: { ...base, messages: ['event', () => 'unsafe'] } },
    { label: 'bigint message', input: { ...base, messages: [1n] } },
    { label: 'non-finite message', input: { ...base, messages: [Number.NaN] } },
    { label: 'custom prototype message', input: { ...base, messages: [customMessage] } },
    { label: 'nested symbol', input: { ...base, messages: [symbolMessage] } }
  ];

  for (const testCase of cases) {
    const result = await executeKafka(testCase.input);
    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
  }

  assert.equal(fetchState.calls, 0);
  assert.equal(callbackCalls, 0);
});

test('kafka snapshots legal deeply nested JSON data without changing wire behavior', async t => {
  const nestedMessage = Object.create(null);
  nestedMessage.event = 'release';
  nestedMessage.details = { versions: [1, 2, { stable: true }], note: null };
  const input = Object.create(null);
  input.topic = 'production-events';
  input.messages = ['deployed', nestedMessage];
  input.key = ['release', { id: 1 }];
  input.headers = {
    'X-Trace': ['fixture', { attempt: 1 }],
    'X-Metadata': { environment: 'production' },
    'X-Null': null
  };
  const options = Object.create(null);
  options.proxyUrl = 'https://valid-proxy.example';
  options.timeoutMs = 1000;
  const originalMessage = JSON.stringify(nestedMessage);

  replaceFetch(t, async (_url, init) => {
    assert.equal(init.headers['X-Trace'], 'fixture,[object Object]');
    assert.equal(init.headers['X-Metadata'], '[object Object]');
    assert.equal(Object.hasOwn(init.headers, 'X-Null'), false);
    assert.deepEqual(JSON.parse(init.body), {
      records: [
        { key: 'release,[object Object]', value: 'deployed' },
        { key: 'release,[object Object]', value: originalMessage }
      ]
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ offsets: [{ partition: 0, offset: 12 }] })
    };
  });

  const result = await executeKafka(input, options);

  assert.equal(result.success, true);
  assert.deepEqual(result.data.offsets, [{ partition: 0, offset: 12 }]);
  assert.equal(JSON.stringify(nestedMessage), originalMessage);
  assert.equal(input.key[1].id, 1);
  assert.equal(input.headers['X-Metadata'].environment, 'production');
});

test('kafka does not fall back from explicit invalid input proxy URLs', async t => {
  const fetchState = forbidFetch(t);

  for (const proxyUrl of ['', null, undefined, '   ', true]) {
    const result = await executeKafka(
      { proxyUrl, topic: 'production-events', messages: ['event'] },
      { proxyUrl: 'https://valid-proxy.example' }
    );

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /proxyUrl.*required/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('kafka rejects explicit invalid input timeouts without falling back to options', async t => {
  const fetchState = forbidFetch(t);

  const invalidTimeouts = [null, undefined, '1000', true, 0, -1, Number.POSITIVE_INFINITY, Number.NaN];

  for (const timeoutMs of invalidTimeouts) {
    const result = await executeKafka(
      {
        proxyUrl: 'https://valid-proxy.example',
        topic: 'production-events',
        messages: ['event'],
        timeoutMs
      },
      { timeoutMs: 5000 }
    );

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /timeoutMs.*positive number/i);
  }

  for (const timeoutMs of invalidTimeouts) {
    const result = await executeKafka(
      {
        proxyUrl: 'https://valid-proxy.example',
        topic: 'production-events',
        messages: ['event']
      },
      { timeoutMs }
    );

    assert.equal(result.success, false);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /timeoutMs.*positive number/i);
  }

  assert.equal(fetchState.calls, 0);
});

test('kafka defaults, falls back, and clamps timeout scheduling', async t => {
  const guardedSetTimeout = global.setTimeout;
  const guardedClearTimeout = global.clearTimeout;
  const scheduledTimeouts = [];
  const clearedTimeouts = [];
  let nextTimerId = 900;

  global.setTimeout = (_callback, timeoutMs) => {
    scheduledTimeouts.push(timeoutMs);
    return nextTimerId++;
  };
  global.clearTimeout = timeoutId => {
    clearedTimeouts.push(timeoutId);
  };
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ offsets: [{ partition: 0, offset: 1 }] })
  }));
  t.after(() => {
    global.setTimeout = guardedSetTimeout;
    global.clearTimeout = guardedClearTimeout;
  });

  const defaultResult = await executeKafka({
    proxyUrl: 'https://valid-proxy.example',
    topic: 'default-timeout',
    messages: ['event']
  });
  const fallbackResult = await executeKafka(
    {
      proxyUrl: 'https://valid-proxy.example',
      topic: 'fallback-timeout',
      messages: ['event']
    },
    { timeoutMs: 45000 }
  );
  const clampedResult = await executeKafka(
    {
      proxyUrl: 'https://valid-proxy.example',
      topic: 'clamped-timeout',
      messages: ['event'],
      timeoutMs: 300000
    },
    { timeoutMs: 1000 }
  );

  assert.equal(defaultResult.success, true);
  assert.equal(fallbackResult.success, true);
  assert.equal(clampedResult.success, true);
  assert.deepEqual(scheduledTimeouts, [30000, 45000, 120000]);
  assert.deepEqual(clearedTimeouts, [900, 901, 902]);
});

test('kafka rejects malformed REST proxy success envelopes', async t => {
  let responseBody;
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseBody)
  }));

  const cases = [
    { label: 'null response', body: null },
    { label: 'string response', body: 'accepted' },
    { label: 'array response', body: [] },
    { label: 'missing offsets', body: {} },
    { label: 'non-array offsets', body: { offsets: {} } },
    { label: 'primitive entry', body: { offsets: [1] } },
    { label: 'array entry', body: { offsets: [[0, 1]] } }
  ];

  for (const testCase of cases) {
    responseBody = testCase.body;
    const result = await executeKafka({
      proxyUrl: 'https://valid-proxy.example',
      topic: 'production-events',
      messages: ['event']
    });

    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /malformed response/i);
  }
});

test('kafka rejects unsafe REST proxy response objects without invoking accessors', async t => {
  const guardedJsonParse = JSON.parse;
  let parsedResponse;
  let accessorReads = 0;
  const customPrototypeResponse = Object.create({ provider: true });
  customPrototypeResponse.offsets = [{ partition: 0, offset: 1 }];
  const accessorResponse = {};
  Object.defineProperty(accessorResponse, 'offsets', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return [{ partition: 0, offset: 1 }];
    }
  });
  const customPrototypeEntry = Object.create({ provider: true });
  customPrototypeEntry.partition = 0;
  customPrototypeEntry.offset = 1;
  const accessorEntry = { offset: 1 };
  Object.defineProperty(accessorEntry, 'partition', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 0;
    }
  });
  const customOffsets = [{ partition: 0, offset: 1 }];
  Object.setPrototypeOf(customOffsets, {
    map: callback => {
      accessorReads += 1;
      return [{ partition: 0, offset: 1 }].map(callback);
    }
  });
  const accessorOffsets = [];
  Object.defineProperty(accessorOffsets, '0', {
    enumerable: true,
    configurable: true,
    get: () => {
      accessorReads += 1;
      return { partition: 0, offset: 1 };
    }
  });
  accessorOffsets.length = 1;
  const symbolOffsets = [{ partition: 0, offset: 1 }];
  symbolOffsets[Symbol('provider')] = 'invalid';
  const sparseOffsets = [];
  sparseOffsets.length = 1;

  JSON.parse = text =>
    text === '__kafka_fixture_response__' ? parsedResponse : guardedJsonParse(text);
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => '__kafka_fixture_response__'
  }));
  t.after(() => {
    JSON.parse = guardedJsonParse;
  });

  const cases = [
    { label: 'custom prototype response', body: customPrototypeResponse },
    { label: 'accessor response', body: accessorResponse },
    { label: 'custom offsets prototype', body: { offsets: customOffsets } },
    { label: 'accessor offsets entry', body: { offsets: accessorOffsets } },
    { label: 'symbol offsets field', body: { offsets: symbolOffsets } },
    { label: 'sparse offsets', body: { offsets: sparseOffsets } },
    { label: 'custom prototype entry', body: { offsets: [customPrototypeEntry] } },
    { label: 'accessor entry', body: { offsets: [accessorEntry] } }
  ];

  for (const testCase of cases) {
    parsedResponse = testCase.body;
    const result = await executeKafka({
      proxyUrl: 'https://valid-proxy.example',
      topic: 'production-events',
      messages: ['event']
    });

    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /malformed response/i);
  }

  assert.equal(accessorReads, 0);
});

test('kafka ignores unknown nested provider response data without reading it', async t => {
  const guardedJsonParse = JSON.parse;
  let nestedAccessorReads = 0;
  const providerMetadata = {};
  Object.defineProperty(providerMetadata, 'secret', {
    enumerable: true,
    get: () => {
      nestedAccessorReads += 1;
      return 'must not be read';
    }
  });
  const parsedResponse = {
    provider: providerMetadata,
    offsets: [
      {
        partition: 0,
        offset: 21,
        provider: providerMetadata
      }
    ]
  };

  JSON.parse = text =>
    text === '__kafka_nested_provider_response__' ? parsedResponse : guardedJsonParse(text);
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => '__kafka_nested_provider_response__'
  }));
  t.after(() => {
    JSON.parse = guardedJsonParse;
  });

  const result = await executeKafka({
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event']
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.offsets, [{ partition: 0, offset: 21 }]);
  assert.equal(nestedAccessorReads, 0);
  assert.doesNotMatch(JSON.stringify(result), /provider|secret|must not be read/);
});

test('kafka rejects invalid REST proxy offset fields', async t => {
  let responseBody;
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(responseBody)
  }));

  const cases = [
    { label: 'missing partition', entry: { offset: 1 } },
    { label: 'negative partition', entry: { partition: -1, offset: 1 } },
    { label: 'fractional partition', entry: { partition: 0.5, offset: 1 } },
    { label: 'unsafe partition', entry: { partition: Number.MAX_SAFE_INTEGER + 1, offset: 1 } },
    { label: 'string partition', entry: { partition: '0', offset: 1 } },
    { label: 'missing result', entry: { partition: 0 } },
    { label: 'negative offset', entry: { partition: 0, offset: -1 } },
    { label: 'fractional offset', entry: { partition: 0, offset: 1.5 } },
    { label: 'unsafe offset', entry: { partition: 0, offset: Number.MAX_SAFE_INTEGER + 1 } },
    { label: 'string offset', entry: { partition: 0, offset: '1' } },
    { label: 'null offset', entry: { partition: 0, offset: null } },
    { label: 'string error code', entry: { partition: 0, error_code: '50003', error: 'failed' } },
    { label: 'fractional error code', entry: { partition: 0, error_code: 50003.5, error: 'failed' } },
    { label: 'missing error', entry: { partition: 0, error_code: 50003 } },
    { label: 'orphan error', entry: { partition: 0, error: 'failed' } },
    { label: 'non-string error', entry: { partition: 0, error_code: 50003, error: 503 } },
    {
      label: 'invalid optional error code',
      entry: { partition: 0, offset: 1, error_code: null, error: 'failed' }
    }
  ];

  for (const testCase of cases) {
    responseBody = { offsets: [testCase.entry] };
    const result = await executeKafka({
      proxyUrl: 'https://valid-proxy.example',
      topic: 'production-events',
      messages: ['event']
    });

    assert.equal(result.success, false, `accepted ${testCase.label}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
    assert.match(result.error.message, /malformed response/i);
  }
});

test('kafka normalizes provider error offsets to controlled camelCase fields', async t => {
  replaceFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        offsets: [
          {
            partition: 0,
            error_code: 50003,
            error: 'broker unavailable',
            unknown: 'drop'
          }
        ]
      })
  }));

  const result = await executeKafka({
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event']
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.offsets, [
    { partition: 0, errorCode: 50003, error: 'broker unavailable' }
  ]);
  assert.doesNotMatch(JSON.stringify(result.data.offsets), /error_code|unknown/);
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

test('kafka does not invoke accessors in HTTP error envelopes', async t => {
  const guardedJsonParse = JSON.parse;
  let parsedResponse;
  let accessorReads = 0;
  const rootMessageAccessor = {};
  Object.defineProperty(rootMessageAccessor, 'message', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'unsafe root message';
    }
  });
  const nestedMessageAccessor = { error: {} };
  Object.defineProperty(nestedMessageAccessor.error, 'message', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return 'unsafe nested message';
    }
  });
  const errorAccessor = {};
  Object.defineProperty(errorAccessor, 'error', {
    enumerable: true,
    get: () => {
      accessorReads += 1;
      return { message: 'unsafe error object' };
    }
  });
  const cases = [rootMessageAccessor, nestedMessageAccessor, errorAccessor, { message: { text: 'complex' } }];
  let status = 501;

  JSON.parse = text =>
    text === '__kafka_error_response__' ? parsedResponse : guardedJsonParse(text);
  replaceFetch(t, async () => ({
    ok: false,
    get status() {
      return status;
    },
    text: async () => '__kafka_error_response__'
  }));
  t.after(() => {
    JSON.parse = guardedJsonParse;
  });

  for (const errorBody of cases) {
    parsedResponse = errorBody;
    const expectedStatus = status;
    const result = await executeKafka({
      proxyUrl: 'https://valid-proxy.example',
      topic: 'production-events',
      messages: ['event']
    });
    status += 1;

    assert.equal(result.success, false);
    assert.equal(result.error.message, `Request failed with status ${expectedStatus}`);
    assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
    assert.equal(result.error.type, 'KafkaPublisherError');
  }

  assert.equal(accessorReads, 0);
});

test('kafka does not invoke arbitrary rejected error accessors', async t => {
  let accessorReads = 0;
  const unsafeError = {};
  Object.defineProperties(unsafeError, {
    name: {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return 'AbortError';
      }
    },
    message: {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return 'unsafe exception message';
      }
    }
  });
  replaceFetch(t, async () => {
    throw unsafeError;
  });

  const result = await executeKafka({
    proxyUrl: 'https://valid-proxy.example',
    topic: 'production-events',
    messages: ['event']
  });

  assert.equal(result.success, false);
  assert.equal(result.error.message, 'Unknown error');
  assert.equal(accessorReads, 0);
});
