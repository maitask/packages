const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
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

function verifyBinanceSignature(rawUrl, secret) {
  const url = new URL(rawUrl, 'http://fixture.local');
  const signature = url.searchParams.get('signature');
  assert.match(signature, /^[a-f0-9]{64}$/);
  url.searchParams.delete('signature');
  const expected = createHmac('sha256', secret).update(url.searchParams.toString()).digest('hex');
  assert.equal(signature, expected);
}

function verifyOkxSignature(request, body, secret) {
  const timestamp = request.headers['ok-access-timestamp'];
  assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T/);
  const prehash = `${timestamp}${request.method}${request.url}${body.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(prehash).digest('base64');
  assert.equal(request.headers['ok-access-sign'], expected);
}

function providerOptions(server, provider, extra = {}) {
  const prefix = provider.toUpperCase();
  return {
    baseUrl: server.url,
    allowInsecureHttp: true,
    allowLiveTrading: true,
    timeoutMs: 2_000,
    maxResponseBytes: 1024 * 1024,
    apiKeySecret: `${prefix}_API_KEY`,
    apiSecretSecret: `${prefix}_API_SECRET`,
    ...(provider === 'okx' ? { passphraseSecret: 'OKX_PASSPHRASE' } : {}),
    secrets: {
      [`${prefix}_API_KEY`]: 'exchange-key',
      [`${prefix}_API_SECRET`]: 'exchange-secret',
      ...(provider === 'okx' ? { OKX_PASSPHRASE: 'passphrase-secret' } : {})
    },
    ...extra
  };
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

test('trader maps Binance futures, Aster futures, and OKX spot and swap public snapshots', async t => {
  const requests = [];
  const server = await listen((request, response) => {
    requests.push(request.url);
    if (request.url.includes('/api/v5/market/candles')) {
      json(response, 200, {
        code: '0',
        msg: '',
        data: candles(25).map(candle => [
          String(candle.openTime), String(candle.open), String(candle.high),
          String(candle.low), String(candle.close), String(candle.volume)
        ]).reverse()
      });
      return;
    }
    if (request.url.includes('/api/v5/market/ticker')) {
      json(response, 200, { code: '0', msg: '', data: [{ instId: 'BTC-USDT', last: '124.00' }] });
      return;
    }
    if (request.url.includes('/klines')) {
      json(response, 200, candles(25).map(candle => [
        candle.openTime, String(candle.open), String(candle.high),
        String(candle.low), String(candle.close), String(candle.volume)
      ]));
      return;
    }
    json(response, 200, { symbol: 'BTCUSDT', price: '124.00' });
  });
  t.after(server.close);

  const cases = [
    { exchange: { provider: 'binance', market: 'futures', environment: 'testnet' }, path: '/fapi/v1/klines' },
    { exchange: { provider: 'aster', market: 'futures', environment: 'testnet' }, path: '/fapi/v1/klines' },
    { exchange: { provider: 'okx', market: 'spot', environment: 'testnet' }, instrument: 'BTC-USDT' },
    { exchange: { provider: 'okx', market: 'swap', environment: 'testnet' }, instrument: 'BTC-USDT-SWAP' }
  ];
  for (const fixture of cases) {
    const result = await execute({
      action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', limit: 25,
      exchange: fixture.exchange
    }, { baseUrl: server.url, allowInsecureHttp: true, timeoutMs: 2_000 });
    const snapshot = item(result);
    assert.equal(snapshot.provider, fixture.exchange.provider);
    assert.equal(snapshot.market, fixture.exchange.market);
    assert.equal(snapshot.price, 124);
    assert.equal(snapshot.candles.length, 25);
    if (fixture.path) assert.ok(requests.some(path => path.startsWith(fixture.path)));
    if (fixture.instrument) assert.ok(requests.some(path => path.includes(`instId=${encodeURIComponent(fixture.instrument)}`)));
  }
});

test('trader signs, normalizes, places, cancels, and maps Binance and Aster live operations', async t => {
  const observed = [];
  const server = await listen(async (request, response) => {
    const body = await readRequest(request);
    observed.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.url.includes('exchangeInfo')) {
      json(response, 200, {
        symbols: [{
          symbol: 'BTCUSDT', status: 'TRADING',
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.10' },
            { filterType: 'LOT_SIZE', minQty: '0.001', stepSize: '0.001' },
            { filterType: 'MARKET_LOT_SIZE', minQty: '0.001', stepSize: '0.001' },
            { filterType: 'MIN_NOTIONAL', minNotional: '5.00', notional: '5.00' }
          ]
        }]
      });
      return;
    }
    if (request.url.startsWith('/api/v3/order') && request.method === 'POST') {
      json(response, 200, {
        symbol: 'BTCUSDT', orderId: 123, clientOrderId: 'spot-order', status: 'NEW',
        side: 'BUY', type: 'LIMIT', origQty: '1.234', price: '100.10', executedQty: '0'
      });
      return;
    }
    if (request.url.startsWith('/fapi/v1/order') && request.method === 'POST') {
      json(response, 200, {
        symbol: 'BTCUSDT', orderId: 456, clientOrderId: 'future-order', status: 'NEW',
        side: 'SELL', type: 'LIMIT', origQty: '2.345', price: '101.20', avgPrice: '0', reduceOnly: true,
        positionSide: 'LONG'
      });
      return;
    }
    if (request.url.startsWith('/fapi/v1/order') && request.method === 'DELETE') {
      json(response, 200, { symbol: 'BTCUSDT', orderId: 456, clientOrderId: 'future-order', status: 'CANCELED' });
      return;
    }
    if (request.url.startsWith('/fapi/v2/account')) {
      json(response, 200, {
        totalWalletBalance: '1000.00', totalUnrealizedProfit: '5.00',
        totalMarginBalance: '1005.00', availableBalance: '800.00',
        assets: [{ asset: 'USDT', walletBalance: '1000.00', availableBalance: '800.00', unrealizedProfit: '5.00' }],
        positions: [{ symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0.25', entryPrice: '100.00', markPrice: '120.00', unrealizedProfit: '5.00', leverage: '10', marginType: 'cross' }]
      });
      return;
    }
    json(response, 500, { message: 'unexpected fixture request' });
  });
  t.after(server.close);

  const spot = await execute({
    action: 'placeOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
    order: { side: 'buy', type: 'limit', quantity: '1.2349', price: '100.199', timeInForce: 'GTC', clientOrderId: 'spot-order' }
  }, providerOptions(server, 'binance'));
  assert.equal(item(spot).order.quantity, '1.234');
  assert.equal(item(spot).order.price, '100.1');

  const future = await execute({
    action: 'placeOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'aster', market: 'futures', environment: 'testnet' },
    order: { side: 'sell', type: 'limit', quantity: '2.3459', price: '101.299', timeInForce: 'GTC', reduceOnly: true, positionSide: 'long', clientOrderId: 'future-order' }
  }, providerOptions(server, 'aster'));
  assert.equal(item(future).order.provider, 'aster');
  assert.equal(item(future).order.reduceOnly, true);

  const account = await execute({
    action: 'accountSnapshot', symbol: 'BTCUSDT',
    exchange: { provider: 'aster', market: 'futures', environment: 'testnet' }
  }, providerOptions(server, 'aster'));
  assert.equal(item(account).account.totalEquity, '1005');
  assert.equal(item(account).account.positions[0].quantity, '0.25');

  const cancelled = await execute({
    action: 'cancelOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'aster', market: 'futures', environment: 'testnet' },
    order: { side: 'sell', type: 'limit', orderId: '456' }
  }, providerOptions(server, 'aster'));
  assert.equal(item(cancelled).cancellation.cancelled, true);

  for (const request of observed.filter(entry => /\/order|\/account/.test(entry.url))) {
    assert.equal(request.headers['x-mbx-apikey'], 'exchange-key');
    verifyBinanceSignature(request.url, 'exchange-secret');
  }
  assert.ok(observed.some(entry => entry.url.includes('quantity=1.234') && entry.url.includes('price=100.1')));
  assert.ok(observed.some(entry => entry.url.includes('quantity=2.345') && entry.url.includes('price=101.2')));
});

test('trader signs and maps OKX spot and swap orders, account snapshots, and cancellations', async t => {
  const observed = [];
  const server = await listen(async (request, response) => {
    const body = await readRequest(request);
    observed.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.url.startsWith('/api/v5/public/instruments')) {
      json(response, 200, { code: '0', msg: '', data: [{
        instId: request.url.includes('SWAP') ? 'BTC-USDT-SWAP' : 'BTC-USDT', state: 'live',
        tickSz: '0.10', lotSz: '0.001', minSz: '0.001', ctVal: request.url.includes('SWAP') ? '0.01' : ''
      }] });
      return;
    }
    if (request.url === '/api/v5/trade/order') {
      json(response, 200, { code: '0', msg: '', data: [{ ordId: 'okx-1', clOrdId: 'client-1', sCode: '0', sMsg: '' }] });
      return;
    }
    if (request.url === '/api/v5/trade/cancel-order') {
      json(response, 200, { code: '0', msg: '', data: [{ ordId: 'okx-1', clOrdId: 'client-1', sCode: '0', sMsg: '' }] });
      return;
    }
    if (request.url.startsWith('/api/v5/account/balance')) {
      json(response, 200, { code: '0', msg: '', data: [{ totalEq: '1005.00', availEq: '800.00', details: [{ ccy: 'USDT', cashBal: '1000.00', availBal: '800.00', frozenBal: '200.00', eq: '1005.00', upl: '5.00' }] }] });
      return;
    }
    if (request.url.startsWith('/api/v5/account/positions')) {
      json(response, 200, { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', posSide: 'long', pos: '2', avgPx: '100.00', markPx: '120.00', upl: '0.40', lever: '5', mgnMode: 'cross' }] });
      return;
    }
    json(response, 500, { message: 'unexpected fixture request' });
  });
  t.after(server.close);

  const placed = await execute({
    action: 'placeOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'okx', market: 'swap', environment: 'testnet' },
    order: { side: 'buy', type: 'limit', quantity: '2.3459', price: '100.199', timeInForce: 'GTC', positionSide: 'long', clientOrderId: 'client-1' }
  }, providerOptions(server, 'okx'));
  assert.equal(item(placed).order.orderId, 'okx-1');
  assert.equal(item(placed).order.quantity, '2.345');
  assert.equal(item(placed).order.price, '100.1');

  const account = await execute({
    action: 'accountSnapshot', symbol: 'BTCUSDT',
    exchange: { provider: 'okx', market: 'swap', environment: 'testnet' }
  }, providerOptions(server, 'okx'));
  assert.equal(item(account).account.totalEquity, '1005');
  assert.equal(item(account).account.positions[0].instrumentId, 'BTC-USDT-SWAP');

  const cancelled = await execute({
    action: 'cancelOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'okx', market: 'swap', environment: 'testnet' },
    order: { side: 'buy', type: 'limit', orderId: 'okx-1' }
  }, providerOptions(server, 'okx'));
  assert.equal(item(cancelled).cancellation.cancelled, true);

  for (const request of observed.filter(entry => entry.url.startsWith('/api/v5/account/') || entry.url.startsWith('/api/v5/trade/'))) {
    assert.equal(request.headers['ok-access-key'], 'exchange-key');
    assert.equal(request.headers['ok-access-passphrase'], 'passphrase-secret');
    assert.equal(request.headers['x-simulated-trading'], '1');
    verifyOkxSignature(request, request.body, 'exchange-secret');
  }
  const orderWire = observed.find(entry => entry.url === '/api/v5/trade/order');
  assert.deepEqual(JSON.parse(orderWire.body), {
    instId: 'BTC-USDT-SWAP', tdMode: 'cross', side: 'buy', ordType: 'limit',
    sz: '2.345', px: '100.1', posSide: 'long', clOrdId: 'client-1'
  });
});

test('trader enforces redirect, deadline, response limits, and one-attempt live mutations', async t => {
  let redirectTargetRequests = 0;
  let mutationRequests = 0;
  const target = await listen((_request, response) => {
    redirectTargetRequests += 1;
    json(response, 200, { price: '1' });
  });
  t.after(target.close);
  const server = await listen((request, response) => {
    if (request.url.includes('redirect')) {
      response.writeHead(302, { location: `${target.url}/target` });
      response.end();
      return;
    }
    if (request.url.includes('slow')) return;
    if (request.url.includes('large')) {
      json(response, 200, { payload: 'x'.repeat(4096) });
      return;
    }
    if (request.url.includes('exchangeInfo')) {
      json(response, 200, { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.1' },
        { filterType: 'LOT_SIZE', minQty: '0.001', stepSize: '0.001' },
        { filterType: 'MIN_NOTIONAL', minNotional: '5' }
      ] }] });
      return;
    }
    mutationRequests += 1;
    json(response, 503, { message: 'uncertain failure' });
  });
  t.after(server.close);

  const baseInput = {
    action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', limit: 20,
    exchange: { provider: 'binance', market: 'spot', environment: 'testnet' }
  };
  const redirected = await execute(baseInput, { baseUrl: `${server.url}/redirect`, allowInsecureHttp: true });
  assertFailure(redirected, 'TRADER_VALIDATION');

  const slowServer = await listen((_request, _response) => {});
  t.after(slowServer.close);
  const timedOut = await execute(baseInput, { baseUrl: slowServer.url, allowInsecureHttp: true, timeoutMs: 20 });
  assertFailure(timedOut, 'TRADER_TIMEOUT');

  const largeServer = await listen((_request, response) => json(response, 200, { payload: 'x'.repeat(4096) }));
  t.after(largeServer.close);
  const tooLarge = await execute(baseInput, { baseUrl: largeServer.url, allowInsecureHttp: true, maxResponseBytes: 128 });
  assertFailure(tooLarge, 'TRADER_RESPONSE_TOO_LARGE');

  const mutation = await execute({
    action: 'placeOrder', symbol: 'BTCUSDT',
    exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
    order: { side: 'buy', type: 'market', quantity: '1' }
  }, providerOptions(server, 'binance'));
  assertFailure(mutation, 'TRADER_PROVIDER');
  assert.equal(mutationRequests, 1);
  assert.equal(redirectTargetRequests, 0);
});

test('trader uses canonical Runtime HTTP transport and keeps provider secrets out of results', async () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = global.fetch;
  const observed = [];
  global.fetch = async () => { throw new Error('fetch must not be used'); };
  globalThis.Deno = {
    core: {
      ops: {
        op_http_request: async (url, request) => {
          observed.push({ url, request });
          const payload = url.includes('/klines')
            ? candles(20).map(candle => [candle.openTime, String(candle.open), String(candle.high), String(candle.low), String(candle.close), String(candle.volume)])
            : { price: '119.00' };
          const body = Buffer.from(JSON.stringify(payload));
          return { status: 200, ok: true, headers: { 'content-type': 'application/json' }, bodyBase64: body.toString('base64'), bodyBytes: body.length };
        }
      }
    }
  };
  try {
    const result = await execute({
      action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m', limit: 20,
      exchange: { provider: 'binance', market: 'spot', environment: 'testnet' }
    }, { baseUrl: 'https://fixture.example', timeoutMs: 2_000, maxResponseBytes: 1024 * 1024 });
    assert.equal(item(result).price, 119);
    assert.equal(observed.length, 2);
    assert.equal(observed[0].request.redirect, 'manual');
    assert.equal(observed[0].request.maxResponseBytes, 1024 * 1024);
  } finally {
    globalThis.Deno = originalDeno;
    global.fetch = originalFetch;
  }
});
