const assert = require('node:assert/strict');
const test = require('node:test');

const { execute: executeKafka } = require('../kafka-publisher');
const { execute: executeSlack } = require('../slack-notifier');
const { execute: executeTelegram } = require('../telegram-bot');
const { createFixtureServer } = require('./helpers/http-fixture');

const nativeFetch = global.fetch;

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
        result: { message_id: 42, chat: { id: -1001 }, text: 'deployment complete' }
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
  assert.equal(result.data.messageId, 42);
  assert.equal(result.data.chatId, -1001);
  assert.equal(result.data.message.text, 'deployment complete');
  assert.equal(Object.hasOwn(result, 'message_id'), false);
  assert.equal(Object.hasOwn(result, 'chat_id'), false);
  assert.equal(result.metadata.method, 'sendMessage');
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram sends a photo from task content without mutating the input', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendPhoto');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(body), {
      chat_id: '-1002',
      photo: 'https://fixtures.example/release.png',
      caption: 'release dashboard',
      parse_mode: 'MarkdownV2'
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
  assert.equal(result.data.messageId, 43);
  assert.equal(result.data.chatId, -1002);
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
      caption: 'quarterly report'
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
  assert.equal(result.data.messageId, 44);
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

test('telegram rejects a non-http base URL without calling fetch', async t => {
  const guardedFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not be called');
  };
  t.after(() => {
    global.fetch = guardedFetch;
  });

  const result = await executeTelegram('invalid endpoint', {
    baseUrl: 'file:///tmp/telegram',
    botToken: 'fixture-token',
    chatId: '-1005'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.type, 'TelegramBotError');
  assert.match(result.error.message, /base URL.*HTTP/i);
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /fixture-token/);
});

test('telegram hides the request URL and bot token when delivery fails', async t => {
  const guardedFetch = global.fetch;
  global.fetch = async url => {
    throw new Error(`network failed at ${url}`);
  };
  t.after(() => {
    global.fetch = guardedFetch;
  });

  const result = await executeTelegram('network failure', {
    baseUrl: 'https://telegram-fixture.invalid/api',
    botToken: 'fixture-token',
    chatId: '-1006'
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'TELEGRAM_ERROR');
  assert.equal(result.error.message, 'Telegram request failed');
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
  assert.equal(result.data.webhook, `${server.url}/services/T***/B***/***`);
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
