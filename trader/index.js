const PACKAGE_NAME = '@maitask/trader';
const PACKAGE_VERSION = '1.0.0';
const CONTRACT_VERSION = '2026-07-11';
const ACTIONS = new Set([
  'marketSnapshot', 'analyze', 'backtest', 'paperOrder',
  'accountSnapshot', 'cancelOrder', 'placeOrder'
]);
const INPUT_FIELDS = new Set([
  'action', 'symbol', 'interval', 'limit', 'candles', 'strategy', 'simulation',
  'paperState', 'referencePrice', 'order', 'exchange'
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
const ORDER_FIELDS = new Set([
  'side', 'type', 'quantity', 'quoteQuantity', 'price', 'timeInForce',
  'reduceOnly', 'positionSide', 'clientOrderId', 'orderId'
]);
const PAPER_STATE_FIELDS = new Set([
  'version', 'quoteBalance', 'positions', 'orders', 'realizedPnl', 'feesPaid', 'equityHistory'
]);
const PAPER_POSITION_FIELDS = new Set(['symbol', 'quantity', 'entryPrice']);
const PAPER_ORDER_FIELDS = new Set([
  'id', 'symbol', 'side', 'type', 'quantity', 'fillPrice', 'fee', 'status', 'simulated', 'createdAt'
]);
const EQUITY_POINT_FIELDS = new Set(['time', 'equity']);

class TraderFailure extends Error {
  constructor(code, message, type, properties = {}) {
    super(message);
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
  try {
    config = buildConfig(rawInput, rawOptions, rawContext);
    let data;
    switch (config.action) {
      case 'analyze':
        data = analyze(config);
        break;
      case 'backtest':
        data = backtest(config);
        break;
      case 'paperOrder':
        data = paperOrder(config);
        break;
      case 'marketSnapshot':
        data = await marketSnapshot(config);
        break;
      case 'placeOrder':
      case 'cancelOrder':
      case 'accountSnapshot':
        data = await liveOperation(config);
        break;
      default:
        throw validationFailure();
    }
    return successResult(config, data, startedAt);
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
        executionId: config ? config.executionId : null,
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
  const symbol = normalizeSymbol(input.symbol);
  const interval = ['marketSnapshot', 'analyze', 'backtest'].includes(action)
    ? normalizeInterval(input.interval)
    : input.interval === undefined ? null : normalizeInterval(input.interval);
  const config = {
    action,
    symbol,
    interval,
    executionId: context.executionId,
    options,
    context,
    limit: boundedInteger(input.limit, 120, 20, 1000),
    exchange: input.exchange === undefined ? null : normalizeExchange(input.exchange),
    candles: input.candles === undefined ? null : normalizeCandles(input.candles),
    strategy: input.strategy === undefined ? normalizeStrategy({}) : normalizeStrategy(input.strategy),
    simulation: normalizeSimulation(input.simulation),
    paperState: input.paperState === undefined ? null : normalizePaperState(input.paperState),
    referencePrice: input.referencePrice === undefined ? null : positiveDecimal(input.referencePrice),
    order: input.order === undefined ? null : normalizeOrder(input.order)
  };
  validateActionConfig(config);
  return config;
}

function validateActionConfig(config) {
  const offline = config.action === 'analyze' || config.action === 'backtest';
  if (offline && !config.candles) throw validationFailure();
  if (config.action === 'paperOrder' && (!config.paperState || !config.referencePrice || !config.order)) {
    throw validationFailure();
  }
  const exchangeAction = ['marketSnapshot', 'accountSnapshot', 'cancelOrder', 'placeOrder'].includes(config.action);
  if (exchangeAction && !config.exchange) throw validationFailure();
  if (config.action === 'placeOrder' && !config.order) throw validationFailure();
  if (config.action === 'cancelOrder' && (!config.order || (!config.order.orderId && !config.order.clientOrderId))) {
    throw validationFailure();
  }
  if (config.action === 'placeOrder' || config.action === 'cancelOrder') {
    if (config.options.allowLiveTrading !== true) throw policyFailure();
    if (config.exchange.environment === 'mainnet' && config.options.allowMainnetTrading !== true) {
      throw policyFailure();
    }
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
  const parameters = {
    fastLength: strategy.fastLength,
    slowLength: strategy.slowLength,
    emaLength: strategy.emaLength,
    rsiLength: strategy.rsiLength,
    volatilityLength: strategy.volatilityLength,
    momentumLookback: strategy.momentumLookback
  };
  return {
    price: closes.at(-1),
    smaFast: sma(closes, strategy.fastLength),
    smaSlow: sma(closes, strategy.slowLength),
    ema: ema(closes, strategy.emaLength),
    rsi: rsi(closes, strategy.rsiLength),
    volatility: volatility(closes, strategy.volatilityLength),
    momentum: closes.at(-1) - closes.at(-(strategy.momentumLookback + 1)),
    parameters
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
  return { signal, confidence: strategy.type === 'manual' ? strategy.confidence : Math.min(1, 0.5 + magnitude), reason };
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
  const warmup = Math.max(config.strategy.slowLength, config.strategy.rsiLength + 1, config.strategy.momentumLookback + 1);

  for (let index = warmup - 1; index < config.candles.length; index += 1) {
    const candle = config.candles[index];
    const segment = config.candles.slice(0, index + 1);
    const recommendation = recommendationFor(indicatorsFor(segment, config.strategy), config.strategy);
    if (position && ((position.side === 'long' && recommendation.signal !== 'long') ||
        (position.side === 'short' && recommendation.signal !== 'short'))) {
      const closed = closeBacktestPosition(position, candle.close, simulation, 'signalChange', candle.openTime);
      cash += closed.cashDelta;
      fees += closed.fee;
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
      const fee = notional * simulation.feeBps / 10_000;
      cash -= fee;
      fees += fee;
      position = { side, quantity, entryPrice: fill, openedAt: candle.openTime };
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
    fees += closed.fee;
    grossPnl += closed.grossPnl;
    trades.push(closed.trade);
    position = null;
  }
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
  const fee = fill * position.quantity * simulation.feeBps / 10_000;
  return {
    cashDelta: grossPnl - fee,
    grossPnl,
    fee,
    trade: {
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: fill,
      grossPnl,
      fee,
      netPnl: grossPnl - fee,
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
  const quantity = Number(order.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw validationFailure();
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
    id: `paper-${state.orders.length + 1}`,
    symbol: config.symbol,
    side: order.side,
    type: order.type,
    quantity: decimal(quantity),
    fillPrice: status === 'filled' ? decimal(fillPrice) : null,
    fee: '0',
    status,
    simulated: true,
    createdAt: new Date().toISOString()
  };
  if (status === 'filled') applyPaperFill(state, receipt, config.simulation, order.reduceOnly === true);
  state.orders.push(receipt);
  const equity = Number(state.quoteBalance) + state.positions.reduce((sum, position) =>
    sum + Number(position.quantity) * reference, 0);
  state.equityHistory.push({ time: Date.now(), equity: decimal(equity) });
  return { action: 'paperOrder', mode: 'paper', order: receipt, paperState: state };
}

function applyPaperFill(state, receipt, simulation, reduceOnly) {
  const quantity = Number(receipt.quantity);
  const price = Number(receipt.fillPrice);
  const notional = quantity * price;
  const fee = notional * simulation.feeBps / 10_000;
  receipt.fee = decimal(fee);
  const index = state.positions.findIndex(position => position.symbol === receipt.symbol);
  const position = index >= 0 ? state.positions[index] : null;
  if (receipt.side === 'buy') {
    if (reduceOnly) throw validationFailure();
    if (Number(state.quoteBalance) < notional + fee) throw validationFailure();
    const priorQuantity = position ? Number(position.quantity) : 0;
    const combined = priorQuantity + quantity;
    const entry = position
      ? (priorQuantity * Number(position.entryPrice) + notional) / combined
      : price;
    const next = { symbol: receipt.symbol, quantity: decimal(combined), entryPrice: decimal(entry) };
    if (position) state.positions[index] = next;
    else state.positions.push(next);
    state.quoteBalance = decimal(Number(state.quoteBalance) - notional - fee);
  } else {
    if (!position || Number(position.quantity) < quantity) throw validationFailure();
    const realized = (price - Number(position.entryPrice)) * quantity;
    const remaining = Number(position.quantity) - quantity;
    state.quoteBalance = decimal(Number(state.quoteBalance) + notional - fee);
    state.realizedPnl = decimal(Number(state.realizedPnl) + realized);
    if (remaining === 0) state.positions.splice(index, 1);
    else state.positions[index] = { ...position, quantity: decimal(remaining) };
  }
  state.feesPaid = decimal(Number(state.feesPaid) + fee);
}

async function marketSnapshot(config) {
  if (config.exchange.provider !== 'binance') throw validationFailure();
  const transport = transportConfig(config);
  const prefix = config.exchange.market === 'spot' ? '/api/v3' : '/fapi/v1';
  const rawCandles = await getJson(
    transport,
    `${prefix}/klines?symbol=${encodeURIComponent(config.symbol)}&interval=${encodeURIComponent(config.interval)}&limit=${config.limit}`
  );
  const ticker = await getJson(transport, `${prefix}/ticker/price?symbol=${encodeURIComponent(config.symbol)}`);
  const mapped = normalizeProviderCandles(rawCandles);
  return {
    action: 'marketSnapshot',
    provider: 'binance',
    market: config.exchange.market,
    environment: config.exchange.environment,
    symbol: config.symbol,
    interval: config.interval,
    price: finitePositive(ticker.price),
    candles: mapped
  };
}

async function liveOperation(config) {
  if (config.action === 'accountSnapshot') throw upstreamFailure();
  throw upstreamFailure();
}

function transportConfig(config) {
  const options = config.options;
  const baseUrl = normalizeBaseUrl(options.baseUrl, options.allowInsecureHttp === true);
  return {
    baseUrl,
    timeoutMs: boundedInteger(options.timeoutMs, 30_000, 10, 120_000),
    maxResponseBytes: boundedInteger(options.maxResponseBytes, 4 * 1024 * 1024, 1, 20 * 1024 * 1024)
  };
}

async function getJson(transport, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), transport.timeoutMs);
  try {
    const response = await fetch(`${transport.baseUrl}${path}`, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      timeoutMs: transport.timeoutMs, maxResponseBytes: transport.maxResponseBytes
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) throw redirectFailure();
    if (response.status < 200 || response.status >= 300) throw providerFailure(response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > transport.maxResponseBytes) throw responseTooLargeFailure();
    return snapshotJson(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof TraderFailure) throw error;
    if (controller.signal.aborted) throw timeoutFailure();
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

function successResult(config, data, startedAt) {
  return {
    success: true,
    data: { items: [{ index: 0, data }], summary: { total: 1, success_count: 1, failure_count: 0 } },
    error: null,
    metadata: {
      contractVersion: CONTRACT_VERSION,
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      action: config.action,
      executionId: config.executionId,
      executedAt: new Date().toISOString(),
      executionMs: Date.now() - startedAt
    },
    citations: []
  };
}

function normalizeExchange(value) {
  const exchange = snapshotKnownRecord(value, EXCHANGE_FIELDS);
  const provider = requiredEnum(exchange.provider, ['binance', 'aster', 'okx']);
  const markets = provider === 'binance' ? ['spot', 'futures'] : provider === 'aster' ? ['futures'] : ['spot', 'swap'];
  return {
    provider,
    market: requiredEnum(exchange.market, markets),
    environment: requiredEnum(exchange.environment, ['testnet', 'mainnet'])
  };
}

function normalizeStrategy(value) {
  const strategy = snapshotKnownRecord(value, STRATEGY_FIELDS);
  const type = strategy.type === undefined ? 'smaCrossover' : requiredEnum(
    strategy.type, ['smaCrossover', 'rsiMeanReversion', 'momentum', 'manual']
  );
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
    manualSignal: strategy.manualSignal === undefined ? 'flat' : requiredEnum(strategy.manualSignal, ['long', 'short', 'flat']),
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

function normalizeOrder(value) {
  const order = snapshotKnownRecord(value, ORDER_FIELDS);
  return {
    side: requiredEnum(order.side, ['buy', 'sell']),
    type: requiredEnum(order.type, ['market', 'limit']),
    quantity: order.quantity === undefined ? null : positiveDecimal(order.quantity),
    quoteQuantity: order.quoteQuantity === undefined ? null : positiveDecimal(order.quoteQuantity),
    price: order.price === undefined ? null : positiveDecimal(order.price),
    timeInForce: order.timeInForce === undefined ? null : requiredEnum(order.timeInForce, ['GTC', 'IOC', 'FOK']),
    reduceOnly: optionalBoolean(order.reduceOnly, false),
    positionSide: order.positionSide === undefined ? null : requiredEnum(order.positionSide, ['long', 'short']),
    clientOrderId: order.clientOrderId === undefined ? null : requiredString(order.clientOrderId, 64),
    orderId: order.orderId === undefined ? null : requiredString(String(order.orderId), 128)
  };
}

function normalizePaperState(value) {
  const state = snapshotKnownRecord(value, PAPER_STATE_FIELDS);
  if (state.version !== 1) throw validationFailure();
  return {
    version: 1,
    quoteBalance: decimal(Number(positiveDecimal(state.quoteBalance))),
    positions: snapshotArray(state.positions).map(item => {
      const position = snapshotKnownRecord(item, PAPER_POSITION_FIELDS);
      return { symbol: normalizeSymbol(position.symbol), quantity: positiveDecimal(position.quantity), entryPrice: positiveDecimal(position.entryPrice) };
    }),
    orders: snapshotArray(state.orders).map(item => snapshotKnownRecord(item, PAPER_ORDER_FIELDS)),
    realizedPnl: decimal(finiteNumber(state.realizedPnl)),
    feesPaid: decimal(Math.max(0, finiteNumber(state.feesPaid))),
    equityHistory: snapshotArray(state.equityHistory).map(item => {
      const point = snapshotKnownRecord(item, EQUITY_POINT_FIELDS);
      return { time: boundedInteger(point.time, undefined, 0, Number.MAX_SAFE_INTEGER), equity: positiveDecimal(point.equity) };
    })
  };
}

function normalizeCandles(value) {
  const items = snapshotArray(value);
  if (items.length < 20 || items.length > 10_000) throw validationFailure();
  let previous = -1;
  return items.map(item => {
    const candle = snapshotKnownRecord(item, CANDLE_FIELDS);
    const normalized = {
      openTime: boundedInteger(candle.openTime, undefined, 0, Number.MAX_SAFE_INTEGER),
      open: finitePositive(candle.open), high: finitePositive(candle.high),
      low: finitePositive(candle.low), close: finitePositive(candle.close),
      volume: finiteNonNegative(candle.volume)
    };
    if (normalized.openTime <= previous || normalized.high < Math.max(normalized.open, normalized.close) ||
        normalized.low > Math.min(normalized.open, normalized.close) || normalized.low > normalized.high) throw validationFailure();
    previous = normalized.openTime;
    return normalized;
  });
}

function normalizeProviderCandles(value) {
  const rows = snapshotArray(value);
  return normalizeCandles(rows.map(row => {
    const values = snapshotArray(row);
    if (values.length < 6) throw upstreamFailure();
    return { openTime: Number(values[0]), open: Number(values[1]), high: Number(values[2]), low: Number(values[3]), close: Number(values[4]), volume: Number(values[5]) };
  }));
}

function sma(values, period) { return values.slice(-period).reduce((sum, value) => sum + value, 0) / period; }
function ema(values, period) { const k = 2 / (period + 1); return values.reduce((result, value, index) => index ? value * k + result * (1 - k) : value, values[0]); }
function rsi(values, period) { let gains = 0; let losses = 0; for (let i = values.length - period; i < values.length; i++) { const change = values[i] - values[i - 1]; if (change > 0) gains += change; else losses -= change; } return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses); }
function volatility(values, period) { const subset = values.slice(-period); const mean = subset.reduce((a, b) => a + b, 0) / subset.length; return Math.sqrt(subset.reduce((sum, value) => sum + (value - mean) ** 2, 0) / subset.length); }
function applySlippage(price, side, bps) { return price * (1 + (side === 'buy' ? 1 : -1) * bps / 10_000); }
function decimal(value) { if (!Number.isFinite(value)) throw validationFailure(); return value.toFixed(12).replace(/\.?0+$/, '') || '0'; }
function positiveDecimal(value) { const text = typeof value === 'string' ? value.trim() : String(value); if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || Number(text) <= 0 || !Number.isFinite(Number(text))) throw validationFailure(); return text; }
function finiteNumber(value) { const number = Number(value); if (!Number.isFinite(number)) throw validationFailure(); return number; }
function finitePositive(value) { const number = finiteNumber(value); if (number <= 0) throw validationFailure(); return number; }
function finiteNonNegative(value) { const number = finiteNumber(value); if (number < 0) throw validationFailure(); return number; }
function normalizeSymbol(value) { const symbol = requiredString(value, 32).toUpperCase(); if (!/^[A-Z0-9]{3,32}$/.test(symbol)) throw validationFailure(); return symbol; }
function normalizeInterval(value) { const interval = requiredString(value, 8); if (!/^(?:[1-9]\d*)(?:m|h|d|w)$/.test(interval)) throw validationFailure(); return interval; }
function normalizeBaseUrl(value, allowInsecure) { const text = requiredString(value, 2048); let url; try { url = new URL(text); } catch { throw validationFailure(); } if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw validationFailure(); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowInsecure && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw policyFailure(); return `${url.protocol}//${url.host}`; }

function readContext(value) { if (value === undefined || value === null) return { executionId: null, secrets: Object.create(null) }; const record = snapshotOpenRecord(value); return { executionId: record.executionId === undefined ? null : requiredString(record.executionId, 256), secrets: record.secrets === undefined ? Object.create(null) : snapshotOpenRecord(record.secrets) }; }
function snapshotKnownRecord(value, allowed) { const record = inspectRecord(value); const result = Object.create(null); for (const [key, descriptor] of Object.entries(record)) { if (!allowed.has(key) || !Object.hasOwn(descriptor, 'value')) throw validationFailure(); result[key] = descriptor.value; } return result; }
function snapshotOpenRecord(value) { const record = inspectRecord(value); const result = Object.create(null); for (const [key, descriptor] of Object.entries(record)) { if (!Object.hasOwn(descriptor, 'value')) throw validationFailure(); result[key] = descriptor.value; } return result; }
function inspectRecord(value) { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validationFailure(); try { if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) throw validationFailure(); return Object.getOwnPropertyDescriptors(value); } catch (error) { if (error instanceof TraderFailure) throw error; throw validationFailure(); } }
function snapshotArray(value) { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) throw validationFailure(); const descriptors = Object.getOwnPropertyDescriptors(value); const length = descriptors.length.value; const result = []; for (let index = 0; index < length; index++) { const descriptor = descriptors[String(index)]; if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw validationFailure(); result.push(descriptor.value); } if (Object.keys(descriptors).some(key => key !== 'length' && !/^\d+$/.test(key))) throw validationFailure(); return result; }
function snapshotJson(value, seen = new Set()) { if (value === null || typeof value === 'string' || typeof value === 'boolean') return value; if (typeof value === 'number') { if (!Number.isFinite(value)) throw upstreamFailure(); return value; } if (typeof value !== 'object' || seen.has(value)) throw upstreamFailure(); seen.add(value); try { if (Array.isArray(value)) return snapshotArray(value).map(item => snapshotJson(item, seen)); const record = snapshotOpenRecord(value); const result = Object.create(null); for (const [key, item] of Object.entries(record)) result[key] = snapshotJson(item, seen); return result; } finally { seen.delete(value); } }
function requiredString(value, max) { if (typeof value !== 'string') throw validationFailure(); const text = value.trim(); if (!text || text.length > max || /[\r\n\0]/.test(text)) throw validationFailure(); return text; }
function requiredEnum(value, allowed) { if (typeof value !== 'string' || !allowed.includes(value)) throw validationFailure(); return value; }
function boundedInteger(value, fallback, min, max) { if (value === undefined) { if (fallback === undefined) throw validationFailure(); return fallback; } if (!Number.isInteger(value) || value < min || value > max) throw validationFailure(); return value; }
function boundedNumber(value, fallback, min, max) { if (value === undefined) return fallback; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw validationFailure(); return value; }
function optionalBoolean(value, fallback) { if (value === undefined) return fallback; if (typeof value !== 'boolean') throw validationFailure(); return value; }
function normalizeFailure(error) { const failure = error instanceof TraderFailure ? error : upstreamFailure(); return { message: failure.message, code: failure.code, type: failure.type, ...(failure.status === undefined ? {} : { status: failure.status }), ...(failure.retriable === undefined ? {} : { retriable: failure.retriable }) }; }
function validationFailure() { return new TraderFailure('TRADER_VALIDATION', 'Invalid trader request.', 'ValidationError', { retriable: false }); }
function policyFailure() { return new TraderFailure('TRADER_POLICY', 'Trader policy denied the operation.', 'PolicyError', { retriable: false }); }
function timeoutFailure() { return new TraderFailure('TRADER_TIMEOUT', 'Trader operation exceeded the total deadline.', 'TimeoutError', { retriable: true }); }
function responseTooLargeFailure() { return new TraderFailure('TRADER_RESPONSE_TOO_LARGE', 'Exchange response exceeded the configured size limit.', 'ResponseLimitError', { retriable: false }); }
function redirectFailure() { return new TraderFailure('TRADER_REDIRECT', 'Exchange redirect was rejected.', 'RedirectError', { retriable: false }); }
function providerFailure(status) { return new TraderFailure('TRADER_PROVIDER', 'Exchange rejected the request.', 'ProviderError', { status, retriable: status === 429 || status >= 500 }); }
function upstreamFailure() { return new TraderFailure('TRADER_UPSTREAM', 'Exchange transport failed.', 'UpstreamError', { retriable: true }); }
