/**
 * @maitask/trader
 * Deterministic market analysis, simulation, paper execution, and controlled exchange trading.
 */

const PACKAGE_NAME = '@maitask/trader';
const PACKAGE_VERSION = '1.0.0';
const CONTRACT_VERSION = '2026-07-11';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_RECV_WINDOW_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACTIONS = new Set([
  'marketSnapshot', 'analyze', 'backtest', 'paperOrder',
  'accountSnapshot', 'cancelOrder', 'placeOrder'
]);
const INPUT_FIELDS = new Set([
  'action', 'symbol', 'interval', 'limit', 'candles', 'strategy', 'simulation',
  'paperState', 'referencePrice', 'eventTime', 'order', 'exchange'
]);
const OPTION_FIELDS = new Set([
  'baseUrl', 'allowInsecureHttp', 'timeoutMs', 'maxResponseBytes',
  'allowLiveTrading', 'allowMainnetTrading', 'apiKeySecret', 'apiSecretSecret',
  'passphraseSecret', 'secrets'
]);
const EXCHANGE_FIELDS = new Set(['provider', 'market', 'environment']);
const STRATEGY_FIELDS = new Set([
  'type', 'fastLength', 'slowLength', 'emaLength', 'rsiLength', 'lowerBand',
  'upperBand', 'volatilityLength', 'momentumLookback', 'manualSignal', 'confidence', 'reason'
]);
const SIMULATION_FIELDS = new Set([
  'initialCapital', 'positionFraction', 'feeBps', 'slippageBps', 'allowLong', 'allowShort'
]);
const CANDLE_FIELDS = new Set(['openTime', 'open', 'high', 'low', 'close', 'volume']);
const PLACE_ORDER_FIELDS = new Set([
  'side', 'type', 'quantity', 'quoteQuantity', 'price', 'timeInForce',
  'reduceOnly', 'positionSide', 'clientOrderId'
]);
const CANCEL_ORDER_FIELDS = new Set(['orderId', 'clientOrderId']);
const PAPER_STATE_FIELDS = new Set([
  'version', 'quoteBalance', 'positions', 'orders', 'realizedPnl', 'feesPaid', 'equityHistory'
]);
const PAPER_POSITION_FIELDS = new Set(['symbol', 'side', 'quantity', 'entryPrice', 'reservedNotional']);
const PAPER_ORDER_FIELDS = new Set([
  'id', 'symbol', 'side', 'type', 'quantity', 'fillPrice', 'fee', 'status',
  'simulated', 'createdAt'
]);
const EQUITY_POINT_FIELDS = new Set(['time', 'equity']);
const INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w'
]);
const OFFICIAL_ORIGINS = Object.freeze({
  'binance:spot:mainnet': 'https://api.binance.com',
  'binance:spot:testnet': 'https://testnet.binance.vision',
  'binance:futures:mainnet': 'https://fapi.binance.com',
  'binance:futures:testnet': 'https://testnet.binancefuture.com',
  'aster:futures:mainnet': 'https://fapi.asterdex.com',
  'okx:spot:mainnet': 'https://www.okx.com',
  'okx:spot:testnet': 'https://www.okx.com',
  'okx:swap:mainnet': 'https://www.okx.com',
  'okx:swap:testnet': 'https://www.okx.com'
});
const TRADER_FAILURES = new WeakSet();

class TraderFailure extends Error {
  constructor(code, message, type, properties = {}) {
    super(message);
    TRADER_FAILURES.add(this);
    this.name = type;
    this.code = code;
    this.type = type;
    if (properties.status !== undefined) this.status = properties.status;
    if (properties.retriable !== undefined) this.retriable = properties.retriable;
  }
}

async function execute(rawInput, rawOptions = {}, rawContext = {}) {
  const startedAt = Date.now();
  let config = null;
  let attempts = 0;
  try {
    config = buildConfig(rawInput, rawOptions, rawContext);
    let data;
    if (config.action === 'analyze') data = analyze(config);
    else if (config.action === 'backtest') data = backtest(config);
    else if (config.action === 'paperOrder') data = paperOrder(config);
    else {
      ensureTransport();
      const operation = createOperation(config, () => { attempts += 1; });
      if (config.action === 'marketSnapshot') data = await marketSnapshot(config, operation);
      else data = await liveOperation(config, operation);
    }
    return successResult(config, data, startedAt, attempts);
  } catch (error) {
    const failure = normalizeFailure(error);
    return {
      success: false,
      error: failure,
      metadata: {
        contractVersion: CONTRACT_VERSION,
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        action: config ? config.action : null,
        provider: config && config.exchange ? config.exchange.provider : null,
        market: config && config.exchange ? config.exchange.market : null,
        environment: config && config.exchange ? config.exchange.environment : null,
        executionId: config ? config.executionId : readSafeExecutionId(rawContext),
        attempts,
        executedAt: new Date().toISOString(),
        executionMs: Date.now() - startedAt
      },
      citations: []
    };
  }
}

if (typeof module !== 'undefined') module.exports = { execute };
execute;

function buildConfig(rawInput, rawOptions, rawContext) {
  const input = snapshotKnownRecord(rawInput, INPUT_FIELDS);
  const options = snapshotKnownRecord(rawOptions, OPTION_FIELDS);
  const context = readContext(rawContext);
  const action = requiredEnum(input.action, [...ACTIONS]);
  const config = {
    action,
    symbol: normalizeSymbol(input.symbol),
    interval: ['marketSnapshot', 'analyze', 'backtest'].includes(action)
      ? normalizeInterval(input.interval)
      : rejectOptionalValue(input.interval),
    executionId: context.executionId,
    options,
    context,
    limit: boundedInteger(input.limit, 120, 20, 300),
    exchange: input.exchange === undefined ? null : normalizeExchange(input.exchange),
    candles: input.candles === undefined ? null : normalizeCandles(input.candles),
    strategy: input.strategy === undefined ? normalizeStrategy({}) : normalizeStrategy(input.strategy),
    simulation: normalizeSimulation(input.simulation),
    paperState: input.paperState === undefined ? null : normalizePaperState(input.paperState),
    referencePrice: input.referencePrice === undefined ? null : positiveDecimal(input.referencePrice),
    eventTime: input.eventTime === undefined
      ? null
      : boundedInteger(input.eventTime, undefined, 0, Number.MAX_SAFE_INTEGER),
    order: input.order === undefined ? null : normalizeOrder(input.order, action)
  };
  validateActionConfig(config);
  return config;
}

function validateActionConfig(config) {
  const { action } = config;
  if ((action === 'analyze' || action === 'backtest') && !config.candles) throw validationFailure();
  if (action === 'analyze' || action === 'backtest') {
    const required = Math.max(
      config.strategy.slowLength,
      config.strategy.emaLength,
      config.strategy.rsiLength + 1,
      config.strategy.volatilityLength,
      config.strategy.momentumLookback + 1
    );
    if (config.candles.length < required) throw validationFailure();
  }
  if (action === 'paperOrder') {
    if (!config.paperState || !config.referencePrice || config.eventTime === null || !config.order) {
      throw validationFailure();
    }
    validatePaperOrder(config.order);
  }
  const exchangeAction = ['marketSnapshot', 'accountSnapshot', 'cancelOrder', 'placeOrder'].includes(action);
  if (exchangeAction && !config.exchange) throw validationFailure();
  if (action === 'placeOrder') {
    if (!config.order) throw validationFailure();
    validateLiveOrder(config.order, config.exchange);
  }
  if (action === 'cancelOrder' && (!config.order || (!config.order.orderId && !config.order.clientOrderId))) {
    throw validationFailure();
  }
  if (action === 'placeOrder' || action === 'cancelOrder') {
    if (config.options.allowLiveTrading !== true) throw policyFailure();
    if (config.exchange.environment === 'mainnet' && config.options.allowMainnetTrading !== true) {
      throw policyFailure();
    }
  }
}

function validatePaperOrder(order) {
  if (!order.quantity || order.quoteQuantity || order.positionSide) throw validationFailure();
  if (order.type === 'limit' && (!order.price || !order.timeInForce)) throw validationFailure();
  if (order.type === 'market' && (order.price || order.timeInForce)) throw validationFailure();
}

function validateLiveOrder(order, exchange) {
  if (Boolean(order.quantity) === Boolean(order.quoteQuantity)) throw validationFailure();
  if (order.type === 'limit' && (!order.price || !order.timeInForce)) throw validationFailure();
  if (order.type === 'market' && (order.price || order.timeInForce)) throw validationFailure();
  const spot = exchange.market === 'spot';
  if (order.quoteQuantity && !(exchange.provider === 'binance' && spot && order.type === 'market')) {
    throw validationFailure();
  }
  if (spot && (order.reduceOnly || order.positionSide)) throw validationFailure();
  if (!spot && order.reduceOnly && order.positionSide) throw validationFailure();
  if (exchange.provider === 'okx' && exchange.market === 'swap' && !order.positionSide) {
    if (order.reduceOnly !== true) throw validationFailure();
  }
}

function analyze(config) {
  const indicators = indicatorsFor(config.candles, config.strategy);
  const recommendation = recommendationFor(indicators, config.strategy);
  return {
    action: 'analyze',
    symbol: config.symbol,
    interval: config.interval,
    candleCount: config.candles.length,
    indicators,
    recommendation: { ...recommendation, executionAuthorized: false }
  };
}

function indicatorsFor(candles, strategy) {
  const closes = candles.map(candle => candle.close);
  return {
    price: closes.at(-1),
    smaFast: sma(closes, strategy.fastLength),
    smaSlow: sma(closes, strategy.slowLength),
    ema: ema(closes, strategy.emaLength),
    rsi: rsi(closes, strategy.rsiLength),
    volatility: volatility(closes, strategy.volatilityLength),
    momentum: closes.at(-1) - closes.at(-(strategy.momentumLookback + 1)),
    parameters: {
      fastLength: strategy.fastLength,
      slowLength: strategy.slowLength,
      emaLength: strategy.emaLength,
      rsiLength: strategy.rsiLength,
      volatilityLength: strategy.volatilityLength,
      momentumLookback: strategy.momentumLookback
    }
  };
}

function recommendationFor(indicators, strategy) {
  let signal = 'flat';
  let reason = 'No strategy condition matched.';
  if (strategy.type === 'smaCrossover') {
    if (indicators.smaFast > indicators.smaSlow) [signal, reason] = ['long', 'Fast SMA is above slow SMA.'];
    else if (indicators.smaFast < indicators.smaSlow) [signal, reason] = ['short', 'Fast SMA is below slow SMA.'];
  } else if (strategy.type === 'rsiMeanReversion') {
    if (indicators.rsi < strategy.lowerBand) [signal, reason] = ['long', 'RSI is below the lower band.'];
    else if (indicators.rsi > strategy.upperBand) [signal, reason] = ['short', 'RSI is above the upper band.'];
  } else if (strategy.type === 'momentum') {
    if (indicators.momentum > 0) [signal, reason] = ['long', 'Momentum is positive.'];
    else if (indicators.momentum < 0) [signal, reason] = ['short', 'Momentum is negative.'];
  } else {
    signal = strategy.manualSignal;
    reason = strategy.reason || 'Manual recommendation.';
  }
  const magnitude = Math.abs(indicators.momentum) / Math.max(indicators.price, 1);
  return {
    signal,
    confidence: strategy.type === 'manual' ? strategy.confidence : Math.min(1, 0.5 + magnitude),
    reason
  };
}

function backtest(config) {
  const simulation = config.simulation;
  let cash = simulation.initialCapital;
  let position = null;
  let fees = 0;
  let grossPnl = 0;
  const trades = [];
  const equityCurve = [];
  let peak = cash;
  let maximumDrawdown = 0;
  const warmup = Math.max(
    config.strategy.slowLength,
    config.strategy.emaLength,
    config.strategy.rsiLength + 1,
    config.strategy.volatilityLength,
    config.strategy.momentumLookback + 1
  );

  for (let index = warmup - 1; index < config.candles.length; index += 1) {
    const candle = config.candles[index];
    const recommendation = recommendationFor(
      indicatorsFor(config.candles.slice(0, index + 1), config.strategy),
      config.strategy
    );
    if (position && ((position.side === 'long' && recommendation.signal !== 'long') ||
        (position.side === 'short' && recommendation.signal !== 'short'))) {
      const closed = closeBacktestPosition(position, candle.close, simulation, 'signalChange', candle.openTime);
      cash += closed.cashDelta;
      fees += closed.exitFee;
      grossPnl += closed.grossPnl;
      trades.push(closed.trade);
      position = null;
    }
    if (!position && ((recommendation.signal === 'long' && simulation.allowLong) ||
        (recommendation.signal === 'short' && simulation.allowShort))) {
      const side = recommendation.signal;
      const fill = applySlippage(candle.close, side === 'long' ? 'buy' : 'sell', simulation.slippageBps);
      const notional = Math.max(0, cash * simulation.positionFraction);
      const quantity = notional / fill;
      const entryFee = notional * simulation.feeBps / 10_000;
      cash -= entryFee;
      fees += entryFee;
      position = { side, quantity, entryPrice: fill, entryFee, openedAt: candle.openTime };
    }
    const equity = cash + unrealized(position, candle.close);
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    equityCurve.push({ time: candle.openTime, equity });
  }
  if (position) {
    const finalCandle = config.candles.at(-1);
    const closed = closeBacktestPosition(position, finalCandle.close, simulation, 'endOfSeries', finalCandle.openTime);
    cash += closed.cashDelta;
    fees += closed.exitFee;
    grossPnl += closed.grossPnl;
    trades.push(closed.trade);
  }
  if (equityCurve.length) equityCurve[equityCurve.length - 1].equity = cash;
  const wins = trades.filter(trade => trade.netPnl > 0).length;
  const losses = trades.filter(trade => trade.netPnl < 0).length;
  return {
    action: 'backtest',
    symbol: config.symbol,
    interval: config.interval,
    assumptions: simulation,
    statistics: {
      initialCapital: simulation.initialCapital,
      finalCapital: cash,
      grossPnl,
      netPnl: cash - simulation.initialCapital,
      fees,
      return: (cash - simulation.initialCapital) / simulation.initialCapital,
      tradeCount: trades.length,
      wins,
      losses,
      winRate: trades.length ? wins / trades.length : 0,
      maximumDrawdown
    },
    trades,
    equityCurve,
    openPosition: null
  };
}

function closeBacktestPosition(position, marketPrice, simulation, reason, closedAt) {
  const exitSide = position.side === 'long' ? 'sell' : 'buy';
  const fill = applySlippage(marketPrice, exitSide, simulation.slippageBps);
  const grossPnl = position.side === 'long'
    ? (fill - position.entryPrice) * position.quantity
    : (position.entryPrice - fill) * position.quantity;
  const exitFee = fill * position.quantity * simulation.feeBps / 10_000;
  const totalFee = position.entryFee + exitFee;
  return {
    cashDelta: grossPnl - exitFee,
    grossPnl,
    exitFee,
    trade: {
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: fill,
      grossPnl,
      fee: totalFee,
      netPnl: grossPnl - totalFee,
      openedAt: position.openedAt,
      closedAt,
      reason
    }
  };
}

function unrealized(position, price) {
  if (!position) return 0;
  return position.side === 'long'
    ? (price - position.entryPrice) * position.quantity
    : (position.entryPrice - price) * position.quantity;
}

function paperOrder(config) {
  const state = config.paperState;
  const order = config.order;
  const reference = Number(config.referencePrice);
  const requestedQuantity = Number(order.quantity);
  let fillPrice = reference;
  let status = 'filled';
  if (order.type === 'limit') {
    const limit = Number(order.price);
    const crossed = order.side === 'buy' ? reference <= limit : reference >= limit;
    if (!crossed) status = 'open';
    fillPrice = limit;
  } else {
    fillPrice = applySlippage(reference, order.side, config.simulation.slippageBps);
  }
  const receipt = {
    id: nextPaperOrderId(state.orders),
    symbol: config.symbol,
    side: order.side,
    type: order.type,
    quantity: decimal(requestedQuantity),
    fillPrice: status === 'filled' ? decimal(fillPrice) : null,
    fee: '0',
    status,
    simulated: true,
    createdAt: new Date(config.eventTime).toISOString()
  };
  if (status === 'filled') applyPaperFill(state, receipt, config.simulation, order.reduceOnly);
  state.orders.push(receipt);
  const equity = Number(state.quoteBalance) + state.positions.reduce((sum, position) => {
    const price = position.symbol === config.symbol ? reference : Number(position.entryPrice);
    const pnl = position.side === 'long'
      ? (price - Number(position.entryPrice)) * Number(position.quantity)
      : (Number(position.entryPrice) - price) * Number(position.quantity);
    return sum + pnl;
  }, 0);
  if (state.equityHistory.length && config.eventTime <= state.equityHistory.at(-1).time) throw validationFailure();
  state.equityHistory.push({ time: config.eventTime, equity: decimal(equity) });
  return { action: 'paperOrder', mode: 'paper', order: receipt, paperState: state };
}

function nextPaperOrderId(orders) {
  let maximum = 0;
  for (const order of orders) {
    const match = /^paper-(\d+)$/.exec(order.id);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return `paper-${maximum + 1}`;
}

function applyPaperFill(state, receipt, simulation, reduceOnly) {
  const quantity = Number(receipt.quantity);
  const price = Number(receipt.fillPrice);
  const notional = quantity * price;
  const fee = notional * simulation.feeBps / 10_000;
  const targetSide = receipt.side === 'buy' ? 'long' : 'short';
  const index = state.positions.findIndex(position => position.symbol === receipt.symbol);
  let position = index >= 0 ? state.positions[index] : null;
  if (!position || position.side === targetSide) {
    if (reduceOnly || (targetSide === 'short' && !simulation.allowShort) ||
        (targetSide === 'long' && !simulation.allowLong)) throw validationFailure();
    const reserved = state.positions.reduce((sum, item) => sum + Number(item.reservedNotional), 0);
    if (reserved + notional + fee > Number(state.quoteBalance)) throw validationFailure();
    if (position) {
      const priorQuantity = Number(position.quantity);
      const combined = priorQuantity + quantity;
      position = {
        symbol: receipt.symbol,
        side: targetSide,
        quantity: decimal(combined),
        entryPrice: decimal((priorQuantity * Number(position.entryPrice) + notional) / combined),
        reservedNotional: decimal(Number(position.reservedNotional) + notional)
      };
      state.positions[index] = position;
    } else {
      state.positions.push({
        symbol: receipt.symbol,
        side: targetSide,
        quantity: receipt.quantity,
        entryPrice: receipt.fillPrice,
        reservedNotional: decimal(notional)
      });
    }
  } else {
    const currentQuantity = Number(position.quantity);
    if (reduceOnly && quantity > currentQuantity) throw validationFailure();
    const closingQuantity = Math.min(quantity, currentQuantity);
    const realized = position.side === 'long'
      ? (price - Number(position.entryPrice)) * closingQuantity
      : (Number(position.entryPrice) - price) * closingQuantity;
    state.realizedPnl = decimal(Number(state.realizedPnl) + realized);
    state.quoteBalance = decimal(Number(state.quoteBalance) + realized);
    const remaining = currentQuantity - closingQuantity;
    const released = Number(position.reservedNotional) * (closingQuantity / currentQuantity);
    if (remaining === 0) state.positions.splice(index, 1);
    else state.positions[index] = {
      ...position,
      quantity: decimal(remaining),
      reservedNotional: decimal(Number(position.reservedNotional) - released)
    };
    const openingQuantity = quantity - closingQuantity;
    if (openingQuantity > 0) {
      if (reduceOnly || (targetSide === 'short' && !simulation.allowShort) ||
          (targetSide === 'long' && !simulation.allowLong)) throw validationFailure();
      const openingNotional = openingQuantity * price;
      const reserved = state.positions.reduce((sum, item) => sum + Number(item.reservedNotional), 0);
      if (reserved + openingNotional + fee > Number(state.quoteBalance)) throw validationFailure();
      state.positions.push({
        symbol: receipt.symbol,
        side: targetSide,
        quantity: decimal(openingQuantity),
        entryPrice: receipt.fillPrice,
        reservedNotional: decimal(openingNotional)
      });
    }
  }
  receipt.fee = decimal(fee);
  state.quoteBalance = decimal(Number(state.quoteBalance) - fee);
  state.feesPaid = decimal(Number(state.feesPaid) + fee);
}

async function marketSnapshot(config, operation) {
  if (config.exchange.provider === 'okx') return okxMarketSnapshot(config, operation);
  return binanceCompatibleMarketSnapshot(config, operation);
}

async function binanceCompatibleMarketSnapshot(config, operation) {
  const prefix = config.exchange.market === 'spot' ? '/api/v3' : '/fapi/v1';
  const query = encodeQuery({ symbol: config.symbol, interval: config.interval, limit: config.limit });
  const candles = await requestJson(operation, 'GET', `${prefix}/klines?${query}`);
  const ticker = await requestJson(operation, 'GET', `${prefix}/ticker/price?symbol=${encodeURIComponent(config.symbol)}`);
  return {
    action: 'marketSnapshot',
    provider: config.exchange.provider,
    market: config.exchange.market,
    environment: config.exchange.environment,
    symbol: config.symbol,
    interval: config.interval,
    price: providerPositiveNumber(providerField(ticker, 'price')),
    candles: normalizeProviderCandles(candles)
  };
}

async function okxMarketSnapshot(config, operation) {
  const instrumentId = okxInstrumentId(config.symbol, config.exchange.market);
  const query = encodeQuery({
    instId: instrumentId,
    bar: okxInterval(config.interval),
    limit: config.limit
  });
  const candleEnvelope = await requestJson(operation, 'GET', `/api/v5/market/candles?${query}`);
  const tickerEnvelope = await requestJson(
    operation,
    'GET',
    `/api/v5/market/ticker?instId=${encodeURIComponent(instrumentId)}`
  );
  const candleRows = okxData(candleEnvelope);
  const tickers = okxData(tickerEnvelope);
  if (tickers.length !== 1) throw upstreamFailure();
  const ticker = providerRecord(tickers[0]);
  return {
    action: 'marketSnapshot',
    provider: 'okx',
    market: config.exchange.market,
    environment: config.exchange.environment,
    symbol: config.symbol,
    instrumentId,
    interval: config.interval,
    price: providerPositiveNumber(providerField(ticker, 'last')),
    candles: normalizeOkxCandles(candleRows)
  };
}

async function liveOperation(config, operation) {
  const credentials = resolveCredentials(config);
  if (config.exchange.provider === 'okx') {
    if (config.action === 'placeOrder') return okxPlaceOrder(config, operation, credentials);
    if (config.action === 'cancelOrder') return okxCancelOrder(config, operation, credentials);
    return okxAccountSnapshot(config, operation, credentials);
  }
  if (config.action === 'placeOrder') return binanceCompatiblePlaceOrder(config, operation, credentials);
  if (config.action === 'cancelOrder') return binanceCompatibleCancelOrder(config, operation, credentials);
  return binanceCompatibleAccountSnapshot(config, operation, credentials);
}

async function binanceCompatiblePlaceOrder(config, operation, credentials) {
  const prefix = config.exchange.market === 'spot' ? '/api/v3' : '/fapi/v1';
  const rulesEnvelope = await requestJson(
    operation,
    'GET',
    `${prefix}/exchangeInfo?symbol=${encodeURIComponent(config.symbol)}`
  );
  const rules = binanceSymbolRules(rulesEnvelope, config.symbol, config.order.type);
  let marketPrice = null;
  if (config.order.type === 'market' && config.order.quantity && rules.minNotional) {
    const ticker = await requestJson(
      operation,
      'GET',
      `${prefix}/ticker/price?symbol=${encodeURIComponent(config.symbol)}`
    );
    marketPrice = providerPositiveDecimal(providerField(ticker, 'price'));
  }
  const normalized = normalizeBinanceOrder(config.order, rules, marketPrice);
  const parameters = {
    symbol: config.symbol,
    side: normalized.side.toUpperCase(),
    type: normalized.type.toUpperCase()
  };
  if (normalized.quantity) parameters.quantity = normalized.quantity;
  if (normalized.quoteQuantity) parameters.quoteOrderQty = normalized.quoteQuantity;
  if (normalized.price) parameters.price = normalized.price;
  if (normalized.timeInForce) parameters.timeInForce = normalized.timeInForce;
  if (config.exchange.market !== 'spot') {
    if (normalized.reduceOnly) parameters.reduceOnly = 'true';
    if (normalized.positionSide) parameters.positionSide = normalized.positionSide.toUpperCase();
  }
  if (normalized.clientOrderId) parameters.newClientOrderId = normalized.clientOrderId;
  const response = await signedBinanceRequest(operation, credentials, 'POST', `${prefix}/order`, parameters);
  return {
    action: 'placeOrder',
    mode: 'live',
    order: mapBinanceOrder(config, response, normalized)
  };
}

async function binanceCompatibleCancelOrder(config, operation, credentials) {
  const prefix = config.exchange.market === 'spot' ? '/api/v3' : '/fapi/v1';
  const parameters = { symbol: config.symbol };
  if (config.order.orderId) parameters.orderId = config.order.orderId;
  else parameters.origClientOrderId = config.order.clientOrderId;
  const response = await signedBinanceRequest(operation, credentials, 'DELETE', `${prefix}/order`, parameters);
  const record = providerRecord(response);
  const orderId = optionalProviderIdentifier(record.orderId) || config.order.orderId;
  const clientOrderId = optionalProviderIdentifier(record.clientOrderId) || config.order.clientOrderId;
  return {
    action: 'cancelOrder',
    mode: 'live',
    cancellation: {
      provider: config.exchange.provider,
      market: config.exchange.market,
      environment: config.exchange.environment,
      symbol: providerSymbol(record.symbol, config.symbol),
      orderId,
      clientOrderId,
      status: optionalProviderEnum(record.status, ['CANCELED', 'CANCELLED', 'EXPIRED'], 'CANCELED').toLowerCase(),
      cancelled: true
    }
  };
}

async function binanceCompatibleAccountSnapshot(config, operation, credentials) {
  const spot = config.exchange.market === 'spot';
  const path = spot ? '/api/v3/account' : '/fapi/v2/account';
  const response = await signedBinanceRequest(operation, credentials, 'GET', path, {});
  const account = spot ? mapBinanceSpotAccount(response) : mapBinanceFuturesAccount(response, config.symbol);
  return {
    action: 'accountSnapshot',
    mode: 'live',
    provider: config.exchange.provider,
    market: config.exchange.market,
    environment: config.exchange.environment,
    account
  };
}

async function signedBinanceRequest(operation, credentials, method, path, parameters) {
  const query = encodeQuery({
    ...parameters,
    timestamp: Date.now(),
    recvWindow: DEFAULT_RECV_WINDOW_MS
  });
  const signature = await hmacSha256(credentials.apiSecret, query, 'hex');
  return requestJson(
    operation,
    method,
    `${path}?${query}&signature=${signature}`,
    { 'x-mbx-apikey': credentials.apiKey }
  );
}

async function okxPlaceOrder(config, operation, credentials) {
  const instrumentId = okxInstrumentId(config.symbol, config.exchange.market);
  const rules = await okxInstrumentRules(config, operation, instrumentId);
  const normalized = normalizeOkxOrder(config.order, rules);
  const body = {
    instId: instrumentId,
    tdMode: config.exchange.market === 'spot' ? 'cash' : 'cross',
    side: normalized.side,
    ordType: okxOrderType(normalized),
    sz: normalized.quantity
  };
  if (config.exchange.market === 'spot' && normalized.type === 'market') body.tgtCcy = 'base_ccy';
  if (normalized.price) body.px = normalized.price;
  if (normalized.positionSide) body.posSide = normalized.positionSide;
  if (normalized.reduceOnly) body.reduceOnly = true;
  if (normalized.clientOrderId) body.clOrdId = normalized.clientOrderId;
  const response = await signedOkxRequest(operation, config, credentials, 'POST', '/api/v5/trade/order', body);
  const result = singleOkxResult(response);
  return {
    action: 'placeOrder',
    mode: 'live',
    order: {
      provider: 'okx',
      market: config.exchange.market,
      environment: config.exchange.environment,
      symbol: config.symbol,
      instrumentId,
      orderId: requiredProviderIdentifier(result.ordId),
      clientOrderId: optionalProviderIdentifier(result.clOrdId) || normalized.clientOrderId,
      status: 'accepted',
      side: normalized.side,
      type: normalized.type,
      quantity: normalized.quantity,
      quoteQuantity: null,
      price: normalized.price,
      averagePrice: null,
      reduceOnly: normalized.reduceOnly,
      positionSide: normalized.positionSide
    }
  };
}

async function okxCancelOrder(config, operation, credentials) {
  const instrumentId = okxInstrumentId(config.symbol, config.exchange.market);
  const body = { instId: instrumentId };
  if (config.order.orderId) body.ordId = config.order.orderId;
  else body.clOrdId = config.order.clientOrderId;
  const response = await signedOkxRequest(
    operation,
    config,
    credentials,
    'POST',
    '/api/v5/trade/cancel-order',
    body
  );
  const result = singleOkxResult(response);
  return {
    action: 'cancelOrder',
    mode: 'live',
    cancellation: {
      provider: 'okx',
      market: config.exchange.market,
      environment: config.exchange.environment,
      symbol: config.symbol,
      instrumentId,
      orderId: optionalProviderIdentifier(result.ordId) || config.order.orderId,
      clientOrderId: optionalProviderIdentifier(result.clOrdId) || config.order.clientOrderId,
      status: 'canceled',
      cancelled: true
    }
  };
}

async function okxAccountSnapshot(config, operation, credentials) {
  const balanceEnvelope = await signedOkxRequest(
    operation,
    config,
    credentials,
    'GET',
    '/api/v5/account/balance'
  );
  let positions = [];
  if (config.exchange.market === 'swap') {
    const instrumentId = okxInstrumentId(config.symbol, config.exchange.market);
    const query = `instId=${encodeURIComponent(instrumentId)}`;
    const positionEnvelope = await signedOkxRequest(
      operation,
      config,
      credentials,
      'GET',
      `/api/v5/account/positions?${query}`
    );
    positions = mapOkxPositions(okxData(positionEnvelope));
  }
  const account = mapOkxBalance(okxData(balanceEnvelope), positions);
  return {
    action: 'accountSnapshot',
    mode: 'live',
    provider: 'okx',
    market: config.exchange.market,
    environment: config.exchange.environment,
    account
  };
}

async function signedOkxRequest(operation, config, credentials, method, requestPath, body = null) {
  const bodyText = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method}${requestPath}${bodyText}`;
  const signature = await hmacSha256(credentials.apiSecret, prehash, 'base64');
  const headers = {
    'ok-access-key': credentials.apiKey,
    'ok-access-sign': signature,
    'ok-access-timestamp': timestamp,
    'ok-access-passphrase': credentials.passphrase
  };
  if (body) headers['content-type'] = 'application/json';
  if (config.exchange.environment === 'testnet') headers['x-simulated-trading'] = '1';
  return requestJson(operation, method, requestPath, headers, bodyText || null);
}

async function okxInstrumentRules(config, operation, instrumentId) {
  const query = encodeQuery({
    instType: config.exchange.market === 'spot' ? 'SPOT' : 'SWAP',
    instId: instrumentId
  });
  const envelope = await requestJson(operation, 'GET', `/api/v5/public/instruments?${query}`);
  const data = okxData(envelope);
  if (data.length !== 1) throw upstreamFailure();
  const record = providerRecord(data[0]);
  if (providerString(record.instId) !== instrumentId || providerString(record.state) !== 'live') {
    throw providerFailure(422);
  }
  return {
    tickSize: providerPositiveDecimal(record.tickSz),
    lotSize: providerPositiveDecimal(record.lotSz),
    minimumSize: providerPositiveDecimal(record.minSz),
    contractValue: record.ctVal === '' || record.ctVal === undefined
      ? null
      : providerPositiveDecimal(record.ctVal),
    maximumMarketSize: optionalProviderPositiveDecimal(record.maxMktSz),
    maximumLimitSize: optionalProviderPositiveDecimal(record.maxLmtSz)
  };
}

function normalizeBinanceOrder(order, rules, marketPrice) {
  const quantity = order.quantity ? floorDecimalToStep(order.quantity, rules.stepSize) : null;
  const quoteQuantity = order.quoteQuantity ? canonicalPositiveDecimal(order.quoteQuantity) : null;
  const price = order.price ? floorDecimalToStep(order.price, rules.tickSize) : null;
  if (quantity && compareDecimals(quantity, rules.minimumQuantity) < 0) throw validationFailure();
  if (quantity && rules.maximumQuantity && compareDecimals(quantity, rules.maximumQuantity) > 0) {
    throw validationFailure();
  }
  if (quoteQuantity && rules.quoteOrderQuantityAllowed !== true) throw validationFailure();
  if (price && rules.minimumPrice && compareDecimals(price, rules.minimumPrice) < 0) throw validationFailure();
  if (price && rules.maximumPrice && compareDecimals(price, rules.maximumPrice) > 0) throw validationFailure();
  if (rules.minNotional) {
    if (quoteQuantity && compareDecimals(quoteQuantity, rules.minNotional) < 0) throw validationFailure();
    const effectivePrice = price || marketPrice;
    if (quantity && effectivePrice && compareDecimals(multiplyDecimals(quantity, effectivePrice), rules.minNotional) < 0) {
      throw validationFailure();
    }
  }
  if (rules.maxNotional) {
    if (quoteQuantity && compareDecimals(quoteQuantity, rules.maxNotional) > 0) throw validationFailure();
    const effectivePrice = price || marketPrice;
    if (quantity && effectivePrice &&
        compareDecimals(multiplyDecimals(quantity, effectivePrice), rules.maxNotional) > 0) {
      throw validationFailure();
    }
  }
  return { ...order, quantity, quoteQuantity, price };
}

function normalizeOkxOrder(order, rules) {
  const quantity = floorDecimalToStep(order.quantity, rules.lotSize);
  if (compareDecimals(quantity, rules.minimumSize) < 0) throw validationFailure();
  const maximumSize = order.type === 'market' ? rules.maximumMarketSize : rules.maximumLimitSize;
  if (maximumSize && compareDecimals(quantity, maximumSize) > 0) throw validationFailure();
  const price = order.price ? floorDecimalToStep(order.price, rules.tickSize) : null;
  return { ...order, quantity, price };
}

function binanceSymbolRules(envelope, symbol, orderType) {
  const root = providerRecord(envelope);
  const symbols = providerArray(root.symbols, 20_000);
  const entry = symbols.map(providerRecord).find(item => providerString(item.symbol) === symbol);
  if (!entry) throw providerFailure(422);
  const status = providerString(entry.status);
  if (status !== 'TRADING') throw providerFailure(422);
  const filters = providerArray(entry.filters, 100).map(providerRecord);
  const byType = type => filters.find(filter => providerString(filter.filterType) === type);
  const priceFilter = byType('PRICE_FILTER');
  const lotFilter = orderType === 'market' ? byType('MARKET_LOT_SIZE') || byType('LOT_SIZE') : byType('LOT_SIZE');
  const fallbackLot = byType('LOT_SIZE');
  if (!priceFilter || !lotFilter || !fallbackLot) throw upstreamFailure();
  let stepSize = providerPositiveDecimal(lotFilter.stepSize);
  let minimumQuantity = providerNonNegativeDecimal(lotFilter.minQty);
  if (isZeroDecimal(stepSize)) stepSize = providerPositiveDecimal(fallbackLot.stepSize);
  if (isZeroDecimal(minimumQuantity)) minimumQuantity = providerPositiveDecimal(fallbackLot.minQty);
  const notional = byType('NOTIONAL') || byType('MIN_NOTIONAL');
  const rawMinimum = notional && (notional.minNotional ?? notional.notional);
  const rawMaximum = notional && notional.maxNotional;
  return {
    tickSize: providerPositiveDecimal(priceFilter.tickSize),
    minimumPrice: optionalProviderPositiveDecimal(priceFilter.minPrice),
    maximumPrice: optionalProviderPositiveDecimal(priceFilter.maxPrice),
    stepSize,
    minimumQuantity,
    maximumQuantity: optionalProviderPositiveDecimal(lotFilter.maxQty),
    minNotional: rawMinimum === undefined ? null : providerPositiveDecimal(rawMinimum),
    maxNotional: rawMaximum === undefined ? null : providerPositiveDecimal(rawMaximum),
    quoteOrderQuantityAllowed: entry.quoteOrderQtyMarketAllowed === true
  };
}

function mapBinanceOrder(config, response, normalized) {
  const record = providerRecord(response);
  const providerSymbolValue = providerSymbol(record.symbol, config.symbol);
  if (record.side !== undefined && providerString(record.side) !== normalized.side.toUpperCase()) throw upstreamFailure();
  if (record.type !== undefined && providerString(record.type) !== normalized.type.toUpperCase()) throw upstreamFailure();
  const rawClientOrderId = optionalProviderIdentifier(record.clientOrderId);
  if (normalized.clientOrderId && rawClientOrderId && rawClientOrderId !== normalized.clientOrderId) {
    throw upstreamFailure();
  }
  if (normalized.quantity && record.origQty !== undefined &&
      compareDecimals(providerNonNegativeDecimal(record.origQty), normalized.quantity) !== 0) {
    throw upstreamFailure();
  }
  if (normalized.price && record.price !== undefined &&
      compareDecimals(providerNonNegativeDecimal(record.price), normalized.price) !== 0) {
    throw upstreamFailure();
  }
  const rawStatus = optionalProviderEnum(
    record.status,
    ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'PENDING_CANCEL', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'],
    'NEW'
  );
  return {
    provider: config.exchange.provider,
    market: config.exchange.market,
    environment: config.exchange.environment,
    symbol: providerSymbolValue,
    orderId: requiredProviderIdentifier(record.orderId),
    clientOrderId: rawClientOrderId || normalized.clientOrderId,
    status: rawStatus.toLowerCase(),
    side: normalized.side,
    type: normalized.type,
    quantity: normalized.quantity,
    quoteQuantity: normalized.quoteQuantity,
    price: normalized.price,
    averagePrice: record.avgPrice === undefined || isZeroDecimal(record.avgPrice)
      ? null
      : providerPositiveDecimal(record.avgPrice),
    reduceOnly: normalized.reduceOnly,
    positionSide: normalized.positionSide
  };
}

function mapBinanceSpotAccount(response) {
  const record = providerRecord(response);
  const balances = providerArray(record.balances, 1000).map(item => {
    const balance = providerRecord(item);
    const available = providerNonNegativeDecimal(balance.free);
    const locked = providerNonNegativeDecimal(balance.locked);
    return {
      asset: providerAsset(balance.asset),
      available,
      locked,
      total: addDecimals(available, locked)
    };
  }).filter(balance => !isZeroDecimal(balance.total));
  return { totalEquity: null, availableBalance: null, unrealizedPnl: null, balances, positions: [] };
}

function mapBinanceFuturesAccount(response, selectedSymbol) {
  const record = providerRecord(response);
  const balancesSource = record.assets === undefined ? [] : providerArray(record.assets, 1000);
  const positionsSource = record.positions === undefined ? [] : providerArray(record.positions, 5000);
  const balances = balancesSource.map(item => {
    const balance = providerRecord(item);
    return {
      asset: providerAsset(balance.asset),
      available: providerNonNegativeDecimal(balance.availableBalance),
      walletBalance: providerSignedDecimal(balance.walletBalance),
      unrealizedPnl: providerSignedDecimal(balance.unrealizedProfit)
    };
  }).filter(balance => !isZeroDecimal(balance.walletBalance) || !isZeroDecimal(balance.unrealizedPnl));
  const positions = positionsSource.map(item => {
    const position = providerRecord(item);
    return {
      symbol: providerSymbol(position.symbol),
      positionSide: optionalProviderEnum(position.positionSide, ['BOTH', 'LONG', 'SHORT'], 'BOTH').toLowerCase(),
      quantity: providerSignedDecimal(position.positionAmt),
      entryPrice: providerNonNegativeDecimal(position.entryPrice),
      markPrice: providerNonNegativeDecimal(position.markPrice),
      unrealizedPnl: providerSignedDecimal(position.unrealizedProfit),
      leverage: providerPositiveIntegerString(position.leverage),
      marginType: optionalProviderEnum(position.marginType, ['cross', 'isolated'], 'cross')
    };
  }).filter(position => position.symbol === selectedSymbol || !isZeroDecimal(position.quantity));
  return {
    totalWalletBalance: providerSignedDecimal(record.totalWalletBalance),
    totalEquity: providerSignedDecimal(record.totalMarginBalance),
    availableBalance: providerNonNegativeDecimal(record.availableBalance),
    unrealizedPnl: providerSignedDecimal(record.totalUnrealizedProfit),
    balances,
    positions
  };
}

function mapOkxBalance(data, positions) {
  if (data.length !== 1) throw upstreamFailure();
  const record = providerRecord(data[0]);
  const details = providerArray(record.details, 1000).map(item => {
    const balance = providerRecord(item);
    return {
      asset: providerAsset(balance.ccy),
      cashBalance: providerSignedDecimalOrZero(balance.cashBal),
      available: providerSignedDecimalOrZero(balance.availBal),
      frozen: providerNonNegativeDecimalOrZero(balance.frozenBal),
      equity: providerSignedDecimalOrZero(balance.eq),
      unrealizedPnl: providerSignedDecimalOrZero(balance.upl)
    };
  }).filter(balance => !isZeroDecimal(balance.equity) || !isZeroDecimal(balance.cashBalance));
  return {
    totalEquity: providerSignedDecimal(record.totalEq),
    availableBalance: record.availEq === undefined || record.availEq === ''
      ? null
      : providerSignedDecimal(record.availEq),
    unrealizedPnl: null,
    balances: details,
    positions
  };
}

function mapOkxPositions(items) {
  return items.map(item => {
    const position = providerRecord(item);
    return {
      instrumentId: providerInstrumentId(position.instId),
      positionSide: optionalProviderEnum(position.posSide, ['long', 'short', 'net'], 'net'),
      quantity: providerSignedDecimal(position.pos),
      entryPrice: providerNonNegativeDecimal(position.avgPx),
      markPrice: providerNonNegativeDecimal(position.markPx),
      unrealizedPnl: providerSignedDecimal(position.upl),
      leverage: providerPositiveIntegerString(position.lever),
      marginMode: optionalProviderEnum(position.mgnMode, ['cross', 'isolated'], 'cross')
    };
  }).filter(position => !isZeroDecimal(position.quantity));
}

function singleOkxResult(envelope) {
  const data = okxData(envelope);
  if (data.length !== 1) throw upstreamFailure();
  const result = providerRecord(data[0]);
  if (providerString(result.sCode) !== '0') throw providerFailure(422);
  return result;
}

function okxData(envelope) {
  const record = providerRecord(envelope);
  if (providerString(record.code) !== '0') throw providerFailure(422);
  return providerArray(record.data, 20_000);
}

function normalizeProviderCandles(value) {
  const rows = providerArray(value, 300);
  return normalizeCandles(rows.map(row => {
    const values = providerArray(row, 20);
    if (values.length < 6) throw upstreamFailure();
    return providerCandle(values);
  }), true);
}

function normalizeOkxCandles(value) {
  const rows = providerArray(value, 300);
  return normalizeCandles(rows.map(row => {
    const values = providerArray(row, 20);
    if (values.length < 6) throw upstreamFailure();
    return providerCandle(values);
  }).reverse(), true);
}

function providerCandle(values) {
  return {
    openTime: providerTimestamp(values[0]),
    open: providerPositiveNumber(values[1]),
    high: providerPositiveNumber(values[2]),
    low: providerPositiveNumber(values[3]),
    close: providerPositiveNumber(values[4]),
    volume: providerNonNegativeNumber(values[5])
  };
}

function createOperation(config, countAttempt) {
  const key = `${config.exchange.provider}:${config.exchange.market}:${config.exchange.environment}`;
  const defaultOrigin = OFFICIAL_ORIGINS[key];
  if (!defaultOrigin) throw validationFailure();
  const allowInsecureHttp = optionalBoolean(config.options.allowInsecureHttp, false);
  const origin = normalizeBaseUrl(
    config.options.baseUrl === undefined ? defaultOrigin : config.options.baseUrl,
    allowInsecureHttp
  );
  return {
    origin,
    deadlineAt: Date.now() + boundedInteger(config.options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 120_000),
    maxResponseBytes: boundedInteger(
      config.options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1,
      20 * 1024 * 1024
    ),
    countAttempt
  };
}

async function requestJson(operation, method, path, headers = {}, body = null) {
  const remainingMs = operation.deadlineAt - Date.now();
  if (remainingMs <= 0) throw timeoutFailure();
  const url = requestUrl(operation.origin, path);
  operation.countAttempt();
  let response;
  if (hasRuntimeHttpOperation()) {
    response = await requestViaRuntime(url, method, headers, body, operation.maxResponseBytes, remainingMs);
  } else {
    response = await requestViaFetch(url, method, headers, body, operation.maxResponseBytes, remainingMs);
  }
  if (Date.now() > operation.deadlineAt) throw timeoutFailure();
  if (REDIRECT_STATUSES.has(response.status)) throw redirectFailure();
  if (response.status < 200 || response.status >= 300) throw providerFailure(response.status);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
    if (!text) throw upstreamFailure();
    return snapshotProviderJson(JSON.parse(text));
  } catch (error) {
    if (isTraderFailure(error)) throw error;
    throw upstreamFailure();
  }
}

async function requestViaRuntime(url, method, headers, body, maxResponseBytes, timeoutMs) {
  const request = { method, headers, redirect: 'manual', timeoutMs, maxResponseBytes };
  if (body !== null) request.body = body;
  let timer = null;
  try {
    const raw = await Promise.race([
      globalThis.Deno.core.ops.op_http_request(url, request),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutFailure()), timeoutMs);
      })
    ]);
    const response = snapshotKnownProviderRecord(
      raw,
      new Set(['status', 'ok', 'headers', 'bodyBase64', 'bodyBytes'])
    );
    const status = boundedProviderInteger(response.status, 100, 599);
    if (typeof response.bodyBase64 !== 'string' || !isCanonicalBase64(response.bodyBase64)) {
      throw upstreamFailure();
    }
    const bytes = base64ToBytes(response.bodyBase64);
    if (response.bodyBytes !== undefined && response.bodyBytes !== bytes.byteLength) throw upstreamFailure();
    if (bytes.byteLength > maxResponseBytes) throw responseTooLargeFailure();
    return { status, bytes };
  } catch (error) {
    if (isTraderFailure(error)) throw error;
    throw upstreamFailure();
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function requestViaFetch(url, method, headers, body, maxResponseBytes, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : body,
      redirect: 'manual',
      signal: controller.signal,
      timeoutMs,
      maxResponseBytes
    });
    return { status: response.status, bytes: await readBoundedBody(response, maxResponseBytes, controller) };
  } catch (error) {
    if (isTraderFailure(error)) throw error;
    if (controller.signal.aborted) throw timeoutFailure();
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response, maxResponseBytes, controller) {
  const declared = response.headers && response.headers.get
    ? Number(response.headers.get('content-length'))
    : NaN;
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    controller.abort();
    throw responseTooLargeFailure();
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) throw responseTooLargeFailure();
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxResponseBytes) {
        controller.abort();
        throw responseTooLargeFailure();
      }
      chunks.push(chunk);
    }
  } finally {
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requestUrl(origin, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\r\n\0]/.test(path)) throw validationFailure();
  let url;
  try { url = new URL(path, `${origin}/`); } catch { throw validationFailure(); }
  if (url.origin !== origin || !url.pathname.startsWith('/')) throw policyFailure();
  return url.toString();
}

function resolveCredentials(config) {
  const provider = config.exchange.provider;
  const optionSecrets = config.options.secrets === undefined
    ? Object.create(null)
    : snapshotSecrets(config.options.secrets);
  const defaults = provider === 'binance'
    ? ['BINANCE_API_KEY', 'BINANCE_API_SECRET', null]
    : provider === 'aster'
      ? ['ASTER_API_KEY', 'ASTER_API_SECRET', null]
      : ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_PASSPHRASE'];
  const apiKeyName = config.options.apiKeySecret === undefined
    ? defaults[0]
    : requiredSecretName(config.options.apiKeySecret);
  const apiSecretName = config.options.apiSecretSecret === undefined
    ? defaults[1]
    : requiredSecretName(config.options.apiSecretSecret);
  const passphraseName = provider === 'okx'
    ? config.options.passphraseSecret === undefined
      ? defaults[2]
      : requiredSecretName(config.options.passphraseSecret)
    : rejectOptionalValue(config.options.passphraseSecret);
  return {
    apiKey: resolveSecret(apiKeyName, optionSecrets, config.context.secrets),
    apiSecret: resolveSecret(apiSecretName, optionSecrets, config.context.secrets),
    passphrase: provider === 'okx'
      ? resolveSecret(passphraseName, optionSecrets, config.context.secrets)
      : null
  };
}

async function hmacSha256(secret, value, encoding) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw upstreamFailure();
  try {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(value)));
    return encoding === 'hex' ? bytesToHex(signature) : bytesToBase64(signature);
  } catch {
    throw upstreamFailure();
  }
}

function normalizeExchange(value) {
  const exchange = snapshotKnownRecord(value, EXCHANGE_FIELDS);
  const provider = requiredEnum(exchange.provider, ['binance', 'aster', 'okx']);
  const markets = provider === 'binance'
    ? ['spot', 'futures']
    : provider === 'aster'
      ? ['futures']
      : ['spot', 'swap'];
  const environments = provider === 'aster' ? ['mainnet'] : ['testnet', 'mainnet'];
  return {
    provider,
    market: requiredEnum(exchange.market, markets),
    environment: requiredEnum(exchange.environment, environments)
  };
}

function normalizeStrategy(value) {
  const strategy = snapshotKnownRecord(value, STRATEGY_FIELDS);
  const type = strategy.type === undefined
    ? 'smaCrossover'
    : requiredEnum(strategy.type, ['smaCrossover', 'rsiMeanReversion', 'momentum', 'manual']);
  const result = {
    type,
    fastLength: boundedInteger(strategy.fastLength, 9, 2, 500),
    slowLength: boundedInteger(strategy.slowLength, 26, 3, 1000),
    emaLength: boundedInteger(strategy.emaLength, 21, 2, 1000),
    rsiLength: boundedInteger(strategy.rsiLength, 14, 2, 500),
    lowerBand: boundedNumber(strategy.lowerBand, 30, 0, 100),
    upperBand: boundedNumber(strategy.upperBand, 70, 0, 100),
    volatilityLength: boundedInteger(strategy.volatilityLength, 20, 2, 1000),
    momentumLookback: boundedInteger(strategy.momentumLookback, 5, 1, 500),
    manualSignal: strategy.manualSignal === undefined
      ? 'flat'
      : requiredEnum(strategy.manualSignal, ['long', 'short', 'flat']),
    confidence: boundedNumber(strategy.confidence, 0.5, 0, 1),
    reason: strategy.reason === undefined ? null : requiredString(strategy.reason, 1024)
  };
  if (result.fastLength >= result.slowLength || result.lowerBand >= result.upperBand) throw validationFailure();
  return result;
}

function normalizeSimulation(value) {
  const simulation = value === undefined ? Object.create(null) : snapshotKnownRecord(value, SIMULATION_FIELDS);
  return {
    initialCapital: boundedNumber(simulation.initialCapital, 10_000, 0.00000001, 1e15),
    positionFraction: boundedNumber(simulation.positionFraction, 0.1, 0.000001, 1),
    feeBps: boundedNumber(simulation.feeBps, 0, 0, 1000),
    slippageBps: boundedNumber(simulation.slippageBps, 0, 0, 1000),
    allowLong: optionalBoolean(simulation.allowLong, true),
    allowShort: optionalBoolean(simulation.allowShort, false)
  };
}

function normalizeOrder(value, action) {
  if (action === 'cancelOrder') {
    const order = snapshotKnownRecord(value, CANCEL_ORDER_FIELDS);
    return {
      orderId: order.orderId === undefined ? null : providerInputIdentifier(order.orderId),
      clientOrderId: order.clientOrderId === undefined ? null : normalizeClientOrderId(order.clientOrderId)
    };
  }
  const order = snapshotKnownRecord(value, PLACE_ORDER_FIELDS);
  return {
    side: requiredEnum(order.side, ['buy', 'sell']),
    type: requiredEnum(order.type, ['market', 'limit']),
    quantity: order.quantity === undefined ? null : positiveDecimal(order.quantity),
    quoteQuantity: order.quoteQuantity === undefined ? null : positiveDecimal(order.quoteQuantity),
    price: order.price === undefined ? null : positiveDecimal(order.price),
    timeInForce: order.timeInForce === undefined
      ? null
      : requiredEnum(order.timeInForce, ['GTC', 'IOC', 'FOK']),
    reduceOnly: optionalBoolean(order.reduceOnly, false),
    positionSide: order.positionSide === undefined
      ? null
      : requiredEnum(order.positionSide, ['long', 'short']),
    clientOrderId: order.clientOrderId === undefined ? null : normalizeClientOrderId(order.clientOrderId)
  };
}

function normalizePaperState(value) {
  const state = snapshotKnownRecord(value, PAPER_STATE_FIELDS);
  if (state.version !== 1) throw validationFailure();
  const positions = snapshotArray(state.positions, 1000).map(item => {
    const position = snapshotKnownRecord(item, PAPER_POSITION_FIELDS);
    return {
      symbol: normalizeSymbol(position.symbol),
      side: requiredEnum(position.side, ['long', 'short']),
      quantity: positiveDecimal(position.quantity),
      entryPrice: positiveDecimal(position.entryPrice),
      reservedNotional: positiveDecimal(position.reservedNotional)
    };
  });
  const symbols = new Set();
  for (const position of positions) {
    if (symbols.has(position.symbol)) throw validationFailure();
    symbols.add(position.symbol);
  }
  return {
    version: 1,
    quoteBalance: nonNegativeDecimal(state.quoteBalance),
    positions,
    orders: snapshotArray(state.orders, 10_000).map(normalizePaperReceipt),
    realizedPnl: signedDecimal(state.realizedPnl),
    feesPaid: nonNegativeDecimal(state.feesPaid),
    equityHistory: snapshotArray(state.equityHistory, 10_000).map(item => {
      const point = snapshotKnownRecord(item, EQUITY_POINT_FIELDS);
      return {
        time: boundedInteger(point.time, undefined, 0, Number.MAX_SAFE_INTEGER),
        equity: signedDecimal(point.equity)
      };
    })
  };
}

function normalizePaperReceipt(value) {
  const receipt = snapshotKnownRecord(value, PAPER_ORDER_FIELDS);
  if (receipt.simulated !== true) throw validationFailure();
  return {
    id: requiredString(receipt.id, 128),
    symbol: normalizeSymbol(receipt.symbol),
    side: requiredEnum(receipt.side, ['buy', 'sell']),
    type: requiredEnum(receipt.type, ['market', 'limit']),
    quantity: positiveDecimal(receipt.quantity),
    fillPrice: receipt.fillPrice === null ? null : positiveDecimal(receipt.fillPrice),
    fee: nonNegativeDecimal(receipt.fee),
    status: requiredEnum(receipt.status, ['open', 'filled']),
    simulated: true,
    createdAt: normalizeIsoTimestamp(receipt.createdAt)
  };
}

function normalizeCandles(value, provider = false) {
  const items = provider ? value : snapshotArray(value, 10_000);
  if (items.length < 20 || items.length > 10_000) throw provider ? upstreamFailure() : validationFailure();
  let previous = -1;
  return items.map(item => {
    const candle = provider ? item : snapshotKnownRecord(item, CANDLE_FIELDS);
    const normalized = {
      openTime: provider
        ? boundedProviderInteger(candle.openTime, 0, Number.MAX_SAFE_INTEGER)
        : boundedInteger(candle.openTime, undefined, 0, Number.MAX_SAFE_INTEGER),
      open: provider ? providerPositiveNumber(candle.open) : finitePositive(candle.open),
      high: provider ? providerPositiveNumber(candle.high) : finitePositive(candle.high),
      low: provider ? providerPositiveNumber(candle.low) : finitePositive(candle.low),
      close: provider ? providerPositiveNumber(candle.close) : finitePositive(candle.close),
      volume: provider ? providerNonNegativeNumber(candle.volume) : finiteNonNegative(candle.volume)
    };
    if (normalized.openTime <= previous || normalized.high < Math.max(normalized.open, normalized.close) ||
        normalized.low > Math.min(normalized.open, normalized.close) || normalized.low > normalized.high) {
      throw provider ? upstreamFailure() : validationFailure();
    }
    previous = normalized.openTime;
    return normalized;
  });
}

function sma(values, period) {
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function ema(values, period) {
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  return values.slice(period).reduce(
    (result, value) => value * multiplier + result * (1 - multiplier),
    seed
  );
}

function rsi(values, period) {
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  if (gains === 0) return 0;
  return 100 - 100 / (1 + gains / losses);
}

function volatility(values, period) {
  const subset = values.slice(-period);
  const mean = subset.reduce((sum, value) => sum + value, 0) / subset.length;
  return Math.sqrt(subset.reduce((sum, value) => sum + (value - mean) ** 2, 0) / subset.length);
}

function applySlippage(price, side, bps) {
  return price * (1 + (side === 'buy' ? 1 : -1) * bps / 10_000);
}

function okxInstrumentId(symbol, market) {
  const quotes = ['USDT', 'USDC', 'BTC', 'ETH'];
  const quote = quotes.find(candidate => symbol.endsWith(candidate));
  if (!quote || symbol.length === quote.length) throw validationFailure();
  const pair = `${symbol.slice(0, -quote.length)}-${quote}`;
  return market === 'spot' ? pair : `${pair}-SWAP`;
}

function okxInterval(interval) {
  const mapping = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1H', '2h': '2H', '4h': '4H', '6h': '6H', '12h': '12H',
    '1d': '1D', '3d': '3D', '1w': '1W'
  };
  if (!mapping[interval]) throw validationFailure();
  return mapping[interval];
}

function okxOrderType(order) {
  if (order.type === 'market') return 'market';
  if (order.timeInForce === 'IOC') return 'ioc';
  if (order.timeInForce === 'FOK') return 'fok';
  return 'limit';
}

function encodeQuery(parameters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== false) query.append(key, String(value));
  }
  return query.toString();
}

function floorDecimalToStep(value, step) {
  const parsedValue = parseDecimal(value, false);
  const parsedStep = parseDecimal(step, false);
  const scale = Math.max(parsedValue.scale, parsedStep.scale);
  const units = parsedValue.units * pow10(scale - parsedValue.scale);
  const stepUnits = parsedStep.units * pow10(scale - parsedStep.scale);
  if (stepUnits <= 0n) throw upstreamFailure();
  const normalized = (units / stepUnits) * stepUnits;
  if (normalized <= 0n) throw validationFailure();
  return formatDecimal(normalized, scale);
}

function multiplyDecimals(left, right) {
  const a = parseDecimal(left, false);
  const b = parseDecimal(right, false);
  return formatDecimal(a.units * b.units, a.scale + b.scale);
}

function addDecimals(left, right) {
  const a = parseDecimal(left, true);
  const b = parseDecimal(right, true);
  const scale = Math.max(a.scale, b.scale);
  return formatDecimal(
    a.units * pow10(scale - a.scale) + b.units * pow10(scale - b.scale),
    scale
  );
}

function compareDecimals(left, right) {
  const a = parseDecimal(left, true);
  const b = parseDecimal(right, true);
  const scale = Math.max(a.scale, b.scale);
  const leftUnits = a.units * pow10(scale - a.scale);
  const rightUnits = b.units * pow10(scale - b.scale);
  return leftUnits === rightUnits ? 0 : leftUnits > rightUnits ? 1 : -1;
}

function parseDecimal(value, allowNegative) {
  if (typeof value !== 'string') throw validationFailure();
  const pattern = allowNegative ? /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/ : /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (!pattern.test(value) || value.length > 80) throw validationFailure();
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > 30 || whole.length > 40) throw validationFailure();
  let units = BigInt(`${whole}${fraction}`);
  if (negative) units = -units;
  return { units, scale: fraction.length };
}

function formatDecimal(units, scale) {
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  if (scale > 0) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  digits = digits.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (digits === '0') return '0';
  return negative ? `-${digits}` : digits;
}

function pow10(exponent) {
  return 10n ** BigInt(exponent);
}

function canonicalPositiveDecimal(value) {
  const parsed = parseDecimal(value, false);
  if (parsed.units <= 0n) throw validationFailure();
  return formatDecimal(parsed.units, parsed.scale);
}

function positiveDecimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw validationFailure();
  const text = typeof value === 'string' ? value.trim() : String(value);
  return canonicalPositiveDecimal(text);
}

function nonNegativeDecimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw validationFailure();
  const text = typeof value === 'string' ? value.trim() : String(value);
  const parsed = parseDecimal(text, false);
  return formatDecimal(parsed.units, parsed.scale);
}

function signedDecimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw validationFailure();
  const text = typeof value === 'string' ? value.trim() : String(value);
  const parsed = parseDecimal(text, true);
  return formatDecimal(parsed.units, parsed.scale);
}

function providerPositiveDecimal(value) {
  try { return positiveDecimal(value); } catch { throw upstreamFailure(); }
}

function providerNonNegativeDecimal(value) {
  try { return nonNegativeDecimal(value); } catch { throw upstreamFailure(); }
}

function providerSignedDecimal(value) {
  try { return signedDecimal(value); } catch { throw upstreamFailure(); }
}

function providerSignedDecimalOrZero(value) {
  return value === undefined || value === null || value === '' ? '0' : providerSignedDecimal(value);
}

function providerNonNegativeDecimalOrZero(value) {
  return value === undefined || value === null || value === '' ? '0' : providerNonNegativeDecimal(value);
}

function optionalProviderPositiveDecimal(value) {
  if (value === undefined || value === null || value === '' || isZeroDecimal(value)) return null;
  return providerPositiveDecimal(value);
}

function isZeroDecimal(value) {
  try { return parseDecimal(String(value), true).units === 0n; } catch { return false; }
}

function decimal(value) {
  if (!Number.isFinite(value)) throw validationFailure();
  const text = value.toFixed(12).replace(/\.?0+$/, '') || '0';
  return signedDecimal(text);
}

function finiteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw validationFailure();
  return value;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  if (number <= 0) throw validationFailure();
  return number;
}

function finiteNonNegative(value) {
  const number = finiteNumber(value);
  if (number < 0) throw validationFailure();
  return number;
}

function providerPositiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw upstreamFailure();
  return number;
}

function providerNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw upstreamFailure();
  return number;
}

function providerTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw upstreamFailure();
  return number;
}

function normalizeSymbol(value) {
  const symbol = requiredString(value, 32).toUpperCase();
  if (!/^[A-Z0-9]{3,32}$/.test(symbol)) throw validationFailure();
  return symbol;
}

function normalizeInterval(value) {
  const interval = requiredString(value, 8);
  if (!INTERVALS.has(interval)) throw validationFailure();
  return interval;
}

function normalizeBaseUrl(value, allowInsecure) {
  const text = requiredString(value, 2048);
  let url;
  try { url = new URL(text); } catch { throw validationFailure(); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw validationFailure();
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol !== 'http:' || !allowInsecure || !isPrivateFixtureHost(url.hostname)) throw policyFailure();
  return url.origin;
}

function isPrivateFixtureHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function readContext(value) {
  if (value === undefined || value === null) return { executionId: null, secrets: Object.create(null) };
  const record = snapshotOpenRecord(value);
  return {
    executionId: record.executionId === undefined ? null : requiredString(record.executionId, 256),
    secrets: record.secrets === undefined ? Object.create(null) : snapshotSecrets(record.secrets)
  };
}

function readSafeExecutionId(value) {
  try {
    if (value === undefined || value === null) return null;
    const record = snapshotOpenRecord(value);
    return record.executionId === undefined ? null : requiredString(record.executionId, 256);
  } catch {
    return null;
  }
}

function snapshotKnownRecord(value, allowed) {
  const record = inspectRecord(value, validationFailure);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(record)) {
    if (!allowed.has(key) || !Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotKnownProviderRecord(value, allowed) {
  const record = inspectRecord(value, upstreamFailure);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(record)) {
    if (!allowed.has(key) || !Object.hasOwn(descriptor, 'value')) throw upstreamFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotOpenRecord(value) {
  const record = inspectRecord(value, validationFailure);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(record)) {
    if (!Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function providerRecord(value) {
  const record = inspectRecord(value, upstreamFailure);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(record)) {
    if (!Object.hasOwn(descriptor, 'value')) throw upstreamFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function inspectRecord(value, failureFactory) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw failureFactory();
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length) throw failureFactory();
    return Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (isTraderFailure(error)) throw error;
    throw failureFactory();
  }
}

function snapshotArray(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length) throw validationFailure();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length.value;
  if (!Number.isSafeInteger(length) || length > maximum) throw validationFailure();
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result.push(descriptor.value);
  }
  if (Object.keys(descriptors).some(key => key !== 'length' && !/^\d+$/.test(key))) throw validationFailure();
  return result;
}

function providerArray(value, maximum) {
  try { return snapshotArray(value, maximum); } catch { throw upstreamFailure(); }
}

function snapshotProviderJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw upstreamFailure();
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw upstreamFailure();
  seen.add(value);
  try {
    if (Array.isArray(value)) return providerArray(value, 100_000).map(item => snapshotProviderJson(item, seen));
    const record = providerRecord(value);
    const result = Object.create(null);
    for (const [key, item] of Object.entries(record)) result[key] = snapshotProviderJson(item, seen);
    return result;
  } finally {
    seen.delete(value);
  }
}

function snapshotSecrets(value) {
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, secret] of Object.entries(record)) {
    requiredSecretName(key);
    result[key] = validateSecret(secret);
  }
  return result;
}

function resolveSecret(name, optionSecrets, contextSecrets) {
  if (Object.hasOwn(optionSecrets, name)) return optionSecrets[name];
  if (Object.hasOwn(contextSecrets, name)) return validateSecret(contextSecrets[name]);
  throw secretUnavailableFailure();
}

function validateSecret(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 16_384 || /[\r\n\0]/.test(value)) {
    throw secretUnavailableFailure();
  }
  return value;
}

function requiredSecretName(value) {
  const name = requiredString(value, 256);
  if (!/^[A-Z][A-Z0-9_]{0,255}$/.test(name)) throw validationFailure();
  return name;
}

function requiredString(value, max) {
  if (typeof value !== 'string') throw validationFailure();
  const text = value.trim();
  if (!text || text.length > max || /[\r\n\0]/.test(text)) throw validationFailure();
  return text;
}

function requiredEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw validationFailure();
  return value;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) {
    if (fallback === undefined) throw validationFailure();
    return fallback;
  }
  if (!Number.isInteger(value) || value < min || value > max) throw validationFailure();
  return value;
}

function boundedProviderInteger(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw upstreamFailure();
  return value;
}

function boundedNumber(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw validationFailure();
  }
  return value;
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validationFailure();
  return value;
}

function rejectOptionalValue(value) {
  if (value !== undefined) throw validationFailure();
  return null;
}

function normalizeClientOrderId(value) {
  const identifier = requiredString(value, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(identifier)) throw validationFailure();
  return identifier;
}

function providerInputIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw validationFailure();
  const identifier = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(identifier)) throw validationFailure();
  return identifier;
}

function providerString(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) throw upstreamFailure();
  return value;
}

function optionalProviderString(value) {
  if (value === undefined || value === null || value === '') return null;
  return providerString(value);
}

function providerField(record, field) {
  if (!Object.hasOwn(record, field)) throw upstreamFailure();
  return record[field];
}

function requiredProviderIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw upstreamFailure();
  const text = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text)) throw upstreamFailure();
  return text;
}

function optionalProviderIdentifier(value) {
  if (value === undefined || value === null || value === '') return null;
  return requiredProviderIdentifier(value);
}

function providerSymbol(value, expected = null) {
  const symbol = providerString(value).toUpperCase();
  if (!/^[A-Z0-9]{3,32}$/.test(symbol) || (expected && symbol !== expected)) throw upstreamFailure();
  return symbol;
}

function providerInstrumentId(value) {
  const identifier = providerString(value).toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+(?:-SWAP)?$/.test(identifier)) throw upstreamFailure();
  return identifier;
}

function providerAsset(value) {
  const asset = providerString(value).toUpperCase();
  if (!/^[A-Z0-9]{1,32}$/.test(asset)) throw upstreamFailure();
  return asset;
}

function optionalProviderEnum(value, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = providerString(value);
  if (!allowed.includes(text)) throw upstreamFailure();
  return text;
}

function providerPositiveIntegerString(value) {
  const text = String(value);
  if (!/^[1-9]\d{0,5}$/.test(text)) throw upstreamFailure();
  return text;
}

function normalizeIsoTimestamp(value) {
  const text = requiredString(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw validationFailure();
  }
  return text;
}

function ensureTransport() {
  if (!hasRuntimeHttpOperation() && typeof fetch !== 'function') throw upstreamFailure();
}

function hasRuntimeHttpOperation() {
  return Boolean(
    globalThis.Deno && globalThis.Deno.core && globalThis.Deno.core.ops &&
    typeof globalThis.Deno.core.ops.op_http_request === 'function'
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  throw upstreamFailure();
}

function base64ToBytes(value) {
  if (!isCanonicalBase64(value)) throw upstreamFailure();
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  throw upstreamFailure();
}

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  try { return bytesToBase64Raw(value) === value; } catch { return false; }
}

function bytesToBase64Raw(value) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('base64');
  const binary = atob(value);
  let rebuilt = '';
  for (let index = 0; index < binary.length; index += 1) rebuilt += binary[index];
  return btoa(rebuilt);
}

function isTraderFailure(value) {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && TRADER_FAILURES.has(value);
}

function successResult(config, data, startedAt, attempts) {
  return {
    success: true,
    data: {
      items: [{ index: 0, data }],
      summary: { total: 1, success_count: 1, failure_count: 0 }
    },
    error: null,
    metadata: {
      contractVersion: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      action: config.action,
      provider: config.exchange ? config.exchange.provider : null,
      market: config.exchange ? config.exchange.market : null,
      environment: config.exchange ? config.exchange.environment : null,
      executionId: config.executionId,
      attempts,
      executedAt: new Date().toISOString(),
      executionMs: Date.now() - startedAt
    },
    citations: []
  };
}

function normalizeFailure(error) {
  const failure = isTraderFailure(error) ? error : upstreamFailure();
  return {
    message: failure.message,
    code: failure.code,
    type: failure.type,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retriable === undefined ? {} : { retriable: failure.retriable })
  };
}

function validationFailure() {
  return new TraderFailure('TRADER_VALIDATION', 'Invalid trader request.', 'ValidationError', { retriable: false });
}

function secretUnavailableFailure() {
  return new TraderFailure(
    'TRADER_SECRET_UNAVAILABLE',
    'Required exchange credentials are unavailable.',
    'SecretUnavailableError',
    { retriable: false }
  );
}

function policyFailure() {
  return new TraderFailure('TRADER_POLICY', 'Trader policy denied the operation.', 'PolicyError', { retriable: false });
}

function timeoutFailure() {
  return new TraderFailure(
    'TRADER_TIMEOUT',
    'Trader operation exceeded the total deadline.',
    'TimeoutError',
    { retriable: true }
  );
}

function responseTooLargeFailure() {
  return new TraderFailure(
    'TRADER_RESPONSE_TOO_LARGE',
    'Exchange response exceeded the configured size limit.',
    'ResponseLimitError',
    { retriable: false }
  );
}

function redirectFailure() {
  return new TraderFailure('TRADER_REDIRECT', 'Exchange redirect was rejected.', 'RedirectError', { retriable: false });
}

function providerFailure(status) {
  return new TraderFailure(
    'TRADER_PROVIDER',
    'Exchange rejected the request.',
    'ProviderError',
    { status, retriable: status === 429 || status >= 500 }
  );
}

function upstreamFailure() {
  return new TraderFailure('TRADER_UPSTREAM', 'Exchange transport failed.', 'UpstreamError', { retriable: true });
}
