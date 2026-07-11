const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');

const { execute } = require('../trader');

function candles(count = 60, start = 100, step = 1) {
  return Array.from({ length: count }, (_, index) => {
    const close = start + index * step;
    return {
      openTime: 1_700_000_000_000 + index * 60_000,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10 + index
    };
  });
}

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(done => {
          server.close(done);
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

function json(response, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    ...headers
  });
  response.end(bytes);
}

function assertFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
  assert.equal(result.metadata.package, '@maitask/trader');
  assert.doesNotMatch(JSON.stringify(result), /exchange-secret|exchange-key|passphrase-secret/i);
}

function item(result) {
  assert.equal(result.success, true);
  return result.data.items[0].data;
}

test('trader analyzes validated local candles without network access', async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    throw new Error('network must not be used');
  };
  try {
    const result = await execute({
      action: 'analyze',
      symbol: 'BTCUSDT',
      interval: '1m',
      candles: candles(),
      strategy: { type: 'smaCrossover', fastLength: 5, slowLength: 20 }
    });
    assert.equal(result.success, true);
    const analysis = item(result);
    assert.equal(analysis.action, 'analyze');
    assert.equal(analysis.symbol, 'BTCUSDT');
    assert.equal(analysis.recommendation.signal, 'long');
    assert.equal(analysis.recommendation.executionAuthorized, false);
    assert.equal(analysis.indicators.parameters.fastLength, 5);
    assert.equal(analysis.indicators.parameters.slowLength, 20);
    assert.equal(analysis.indicators.price, 159);
    assert.equal(requests, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('trader backtest closes final positions and accounts for fees and slippage', async () => {
  const result = await execute({
    action: 'backtest',
    symbol: 'BTCUSDT',
    interval: '1m',
    candles: candles(80, 100, 1),
    strategy: { type: 'smaCrossover', fastLength: 3, slowLength: 8 },
    simulation: {
      initialCapital: 10_000,
      positionFraction: 0.5,
      feeBps: 10,
      slippageBps: 5,
      allowLong: true,
      allowShort: false
    }
  });
  assert.equal(result.success, true);
  const backtest = item(result);
  assert.equal(backtest.action, 'backtest');
  assert.equal(backtest.assumptions.feeBps, 10);
  assert.equal(backtest.assumptions.slippageBps, 5);
  assert.equal(backtest.openPosition, null);
  assert.ok(backtest.statistics.tradeCount >= 1);
  assert.ok(Number.isFinite(backtest.statistics.netPnl));
  assert.ok(Number.isFinite(backtest.statistics.maximumDrawdown));
  assert.equal(backtest.trades.at(-1).reason, 'endOfSeries');
});

test('trader applies deterministic resumable paper orders without exchange credentials', async () => {
  const opened = await execute({
    action: 'paperOrder',
    symbol: 'BTCUSDT',
    referencePrice: '100.00',
    order: { side: 'buy', type: 'market', quantity: '2.000' },
    simulation: { feeBps: 10, slippageBps: 5 },
    paperState: {
      version: 1,
      quoteBalance: '1000.00',
      positions: [],
      orders: [],
      realizedPnl: '0',
      feesPaid: '0',
      equityHistory: []
    }
  });
  assert.equal(opened.success, true);
  const first = item(opened);
  assert.equal(first.action, 'paperOrder');
  assert.equal(first.mode, 'paper');
  assert.equal(first.order.simulated, true);
  assert.equal(first.order.status, 'filled');
  assert.equal(first.paperState.version, 1);
  assert.equal(first.paperState.positions[0].symbol, 'BTCUSDT');

  const closed = await execute({
    action: 'paperOrder',
    symbol: 'BTCUSDT',
    referencePrice: '110.00',
    order: { side: 'sell', type: 'market', quantity: '2.000', reduceOnly: true },
    simulation: { feeBps: 10, slippageBps: 5 },
    paperState: first.paperState
  });
  assert.equal(closed.success, true);
  const second = item(closed);
  assert.equal(second.paperState.positions.length, 0);
  assert.ok(Number(second.paperState.realizedPnl) > 0);
  assert.equal(first.paperState.positions.length, 1, 'source paper state remains detached');
});

test('trader maps a controlled Binance public market snapshot without credentials', async t => {
  const requests = [];
  const server = await listen((request, response) => {
    requests.push(request.url);
    if (request.url.startsWith('/api/v3/klines')) {
      json(response, 200, candles(25).map(candle => [
        candle.openTime,
        String(candle.open),
        String(candle.high),
        String(candle.low),
        String(candle.close),
        String(candle.volume)
      ]));
      return;
    }
    json(response, 200, { symbol: 'BTCUSDT', price: '124.00' });
  });
  t.after(server.close);

  const result = await execute({
    action: 'marketSnapshot',
    symbol: 'BTCUSDT',
    interval: '1m',
    limit: 25,
    exchange: { provider: 'binance', market: 'spot', environment: 'testnet' }
  }, {
    baseUrl: server.url,
    allowInsecureHttp: true,
    timeoutMs: 2_000,
    maxResponseBytes: 1024 * 1024
  });
  assert.equal(result.success, true);
  const snapshot = item(result);
  assert.equal(snapshot.provider, 'binance');
  assert.equal(snapshot.market, 'spot');
  assert.equal(snapshot.price, 124);
  assert.equal(snapshot.candles.length, 25);
  assert.deepEqual(requests, [
    '/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=25',
    '/api/v3/ticker/price?symbol=BTCUSDT'
  ]);
});

test('trader refuses live and mainnet mutations before network contact without trusted authority', async t => {
  let requests = 0;
  const server = await listen((_request, response) => {
    requests += 1;
    response.end();
  });
  t.after(server.close);

  const input = {
    action: 'placeOrder',
    symbol: 'BTCUSDT',
    exchange: { provider: 'binance', market: 'spot', environment: 'mainnet' },
    order: { side: 'buy', type: 'market', quoteQuantity: '100.00' }
  };
  const baseOptions = {
    baseUrl: server.url,
    allowInsecureHttp: true,
    apiKeySecret: 'BINANCE_API_KEY',
    apiSecretSecret: 'BINANCE_API_SECRET',
    secrets: { BINANCE_API_KEY: 'exchange-key', BINANCE_API_SECRET: 'exchange-secret' }
  };
  const noLive = await execute(input, baseOptions);
  assertFailure(noLive, 'TRADER_POLICY');
  const noMainnet = await execute(input, { ...baseOptions, allowLiveTrading: true });
  assertFailure(noMainnet, 'TRADER_POLICY');
  assert.equal(requests, 0);
});

test('trader rejects ambiguous legacy actions, input credentials, aliases, and behavioral data', async () => {
  const accessor = {};
  Object.defineProperty(accessor, 'action', { enumerable: true, get() { throw new Error('accessed'); } });
  const cyclic = {};
  cyclic.self = cyclic;
  const cases = [
    accessor,
    { action: 'execute', symbol: 'BTCUSDT' },
    { action: 'stream', symbol: 'BTCUSDT' },
    { action: 'status', symbol: 'BTCUSDT' },
    { action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', exchange: { provider: 'binance', apiKey: 'exchange-key' } },
    { action: 'analyze', symbol: 'BTCUSDT', interval: '1m', candles: candles(), candle_limit: 20 },
    { action: 'analyze', symbol: 'BTCUSDT', interval: '1m', candles: cyclic },
    { action: 'analyze', symbol: 'BTCUSDT', interval: '1m', candles: candles(), unknown: true }
  ];
  for (const input of cases) {
    const result = await execute(input);
    assertFailure(result, 'TRADER_VALIDATION');
  }
});
