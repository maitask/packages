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
  assert.equal(result.message_id, 42);
  assert.equal(result.chat_id, -1001);
  assert.equal(result.metadata.method, 'sendMessage');
});

test('telegram returns a structured API failure through the Runtime endpoint fallback', async t => {
  const server = await createFixtureServer(url => {
    assert.equal(url.pathname, '/telegram/botfixture-token/sendMessage');
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

test('slack sends the formal webhook payload and masks the result URL', async t => {
  const server = await createFixtureServer((url, request, body) => {
    assert.equal(url.pathname, '/services/T000/B000/fixture-secret');
    assert.equal(request.method, 'POST');
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
  const server = await createFixtureServer(() => ({
    status: 429,
    headers: { 'content-type': 'text/plain', 'retry-after': '3' },
    body: 'rate_limited'
  }));
  t.after(() => server.close());

  const result = await executeSlack(
    { text: 'retry later' },
    { webhookUrl: `${server.url}/services/T111/B111/fixture-secret` }
  );

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'SLACK_ERROR');
  assert.match(result.error.message, /429.*rate_limited/);
  assert.equal(result.error.retriable, true);
  assert.equal(result.error.details?.retryAfterSeconds, 3);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
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
});

test('kafka returns a structured REST proxy failure', async t => {
  const server = await createFixtureServer(() => ({
    status: 503,
    body: { error: { message: 'broker unavailable' } }
  }));
  t.after(() => server.close());

  const result = await executeKafka({
    proxyUrl: server.url,
    topic: 'production-events',
    messages: ['event']
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'KAFKA_PUBLISHER_ERROR');
  assert.equal(result.error.type, 'KafkaPublisherError');
  assert.equal(result.error.message, 'broker unavailable');
});
