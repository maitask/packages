import { createExchangeClient } from './providers/factory.js';
import { ensureFetch, ensureCrypto, mergeObjects, toNumber, sanitizePrecision } from './shared/utils.js';
import { buildDefaultPaperState } from './shared/state.js';

/**
 * @maitask/trader
 * Multi-market trading orchestration covering analysis through execution.
 *
 * Features:
 * - Market snapshot + indicator analysis (SMA, EMA, RSI, volatility, momentum)
 * - Configurable strategy templates (sma-crossover, rsi-mean-reversion, momentum-breakout, manual)
 * - Risk management (position sizing, leverage cap, drawdown and loss guards)
 * - Live order routing targeting Binance futures/spot, Aster futures, and OKX swap/spot markets
 * - Paper trading simulator offering deterministic fills, equity tracking, and resumable state
 * - Account/status queries, cancels, and historical backtests sharing a single orchestration layer
 */

const DEFAULT_INTERVAL = '5m';
const DEFAULT_CANDLE_LIMIT = 120;

/**
 * Main entry.
 * @param {Object} input
 * @param {Object} options
 * @param {Object} context
 */
async function execute(input = {}, options = {}, context = {}) {
    ensureFetch();
    ensureCrypto();

    const config = buildConfig(input, options, context);
    const exchange = await createExchangeClient(config);

    try {
        switch (config.action) {
            case 'analyze':
                return successResponse(await performAnalysis(config, exchange));
            case 'execute':
                return successResponse(await performExecution(config, exchange));
            case 'status':
                return successResponse(await fetchStatus(config, exchange));
            case 'cancel':
                return successResponse(await cancelOrder(config, exchange));
            case 'backtest':
                return successResponse(await runBacktest(config, exchange));
            case 'stream':
                return successResponse(await performStream(config, exchange));
            default:
                throw new Error(`Unsupported action: ${config.action}`);
        }
    } catch (error) {
        return {
            success: false,
            action: config.action,
            message: error.message,
            stack: error.stack,
        };
    }
}

function successResponse(payload) {
    return {
        success: true,
        ...payload,
        timestamp: new Date().toISOString(),
    };
}

function buildConfig(input, options, context) {
    const source = mergeObjects(options, input);
    const action = (source.action || 'analyze').toLowerCase();

    const exchange = source.exchange || {};
    exchange.provider = (exchange.provider || source.provider || 'binance').toLowerCase();
    const defaultMarket = exchange.provider === 'binance' ? 'futures' : exchange.provider === 'paper' ? 'paper' : 'swap';
    exchange.market = (exchange.market || source.market || defaultMarket).toLowerCase();
    const defaultTestnet = exchange.provider === 'binance' ? true : false;
    exchange.testnet = exchange.testnet ?? source.testnet ?? defaultTestnet;
    exchange.apiKey = exchange.apiKey || exchange.api_key || source.apiKey || source.api_key || context?.secrets?.BINANCE_API_KEY;
    exchange.apiSecret = exchange.apiSecret || exchange.api_secret || source.apiSecret || source.api_secret || context?.secrets?.BINANCE_API_SECRET;
    exchange.passphrase = exchange.passphrase || source.passphrase || context?.secrets?.OKX_PASSPHRASE;

    if (!exchange.apiKey) {
        if (exchange.provider === 'okx') {
            exchange.apiKey = context?.secrets?.OKX_API_KEY;
        } else if (exchange.provider === 'aster') {
            exchange.apiKey = context?.secrets?.ASTER_API_KEY;
        }
    }

    if (!exchange.apiSecret) {
        if (exchange.provider === 'okx') {
            exchange.apiSecret = context?.secrets?.OKX_API_SECRET;
        } else if (exchange.provider === 'aster') {
            exchange.apiSecret = context?.secrets?.ASTER_API_SECRET;
        }
    }

    if (!exchange.passphrase && exchange.provider === 'okx') {
        exchange.passphrase = context?.secrets?.OKX_PASSPHRASE;
    }

    return {
        action,
        symbol: (source.symbol || 'BTCUSDT').toUpperCase(),
        interval: source.interval || DEFAULT_INTERVAL,
        candleLimit: Math.min(Math.max(source.candles || source.candleLimit || DEFAULT_CANDLE_LIMIT, 20), 1000),
        strategy: source.strategy || {},
        decision: source.decision,
        quantity: toNumber(source.quantity),
        quoteQuantity: toNumber(source.quoteQuantity || source.notional),
        price: toNumber(source.price),
        leverage: Math.min(toNumber(source.leverage) || 1, source.maxLeverage || 50),
        execution: source.execution || {},
        risk: buildRiskConfig(source),
        performance: source.performance || {},
        exchange,
        paperState: source.paperState || buildDefaultPaperState(),
        backtest: source.backtest || {},
        stream: source.stream || {},
    };
}

function buildRiskConfig(source) {
    return {
        maxDailyLoss: toNumber(source.maxDailyLoss ?? source?.risk?.maxDailyLoss),
        maxDrawdown: toNumber(source.maxDrawdown ?? source?.risk?.maxDrawdown),
        maxPositionSize: toNumber(source.maxPositionSize ?? source?.risk?.maxPositionSize),
        positionRiskPct: toNumber(source.positionRiskPct ?? source?.risk?.positionRiskPct) || 0.02,
        slippageBps: toNumber(source.slippageBps ?? source?.risk?.slippageBps) || 5,
        stopLossPct: toNumber(source.stopLossPct ?? source?.risk?.stopLossPct) || 0.01,
        takeProfitPct: toNumber(source.takeProfitPct ?? source?.risk?.takeProfitPct) || 0.02,
        allowShort: source.allowShort ?? source?.risk?.allowShort ?? true,
        allowLong: source.allowLong ?? source?.risk?.allowLong ?? true,
    };
}

async function performAnalysis(config, exchange) {
    const snapshot = await exchange.getMarketSnapshot(config.symbol, config.interval, config.candleLimit);
    const indicators = buildIndicators(snapshot.candles, config.strategy);
    const decision = deriveDecision(indicators, config);
    const risk = evaluateRisk(decision, config);

    return {
        mode: exchange.mode,
        symbol: config.symbol,
        analysis: {
            decision,
            indicators,
            risk,
            market: snapshot,
        },
    };
}

async function performExecution(config, exchange) {
    const snapshot = await exchange.getMarketSnapshot(config.symbol, config.interval, config.candleLimit);
    const indicators = buildIndicators(snapshot.candles, config.strategy);
    const baseDecision = config.decision || deriveDecision(indicators, config);
    const risk = evaluateRisk(baseDecision, config);

    if (!risk.allowed) {
        return {
            status: 'blocked',
            reason: 'Risk limits prevent execution',
            risk,
            analysis: { decision: baseDecision, indicators, market: snapshot },
        };
    }

    if (baseDecision.signal === 'flat') {
        return {
            status: 'skipped',
            reason: 'Decision returned flat signal',
            analysis: { decision: baseDecision, indicators, market: snapshot },
        };
    }

    const orderSide = baseDecision.signal === 'long' ? 'BUY' : 'SELL';
    if (orderSide === 'SELL' && !config.risk.allowShort) {
        throw new Error('Short trades disallowed by configuration');
    }
    if (orderSide === 'BUY' && !config.risk.allowLong) {
        throw new Error('Long trades disallowed by configuration');
    }

    const price = config.price || snapshot.price;
    const quantity = determineQuantity(config, price);
    if (!quantity || quantity <= 0) {
        throw new Error('Unable to determine a valid order quantity');
    }

    const orderRequest = {
        symbol: config.symbol,
        side: orderSide,
        type: (config.execution.type || 'MARKET').toUpperCase(),
        quantity,
        quoteQuantity: config.quoteQuantity,
        price: config.price || (config.execution.type && config.execution.type.toUpperCase() === 'LIMIT' ? price : undefined),
        leverage: config.leverage,
        positionSide: baseDecision.signal === 'long' ? 'LONG' : 'SHORT',
        reduceOnly: config.execution.reduceOnly ?? false,
        timeInForce: config.execution.timeInForce || 'GTC',
        clientOrderId: config.execution.clientOrderId,
        referencePrice: snapshot.price,
        stopLossPct: config.risk.stopLossPct,
        takeProfitPct: config.risk.takeProfitPct,
    };

    const orderResult = await exchange.placeOrder(orderRequest);
    const orderDetails = orderResult?.order || orderResult;
    const status = await exchange.getAccountSnapshot(config.symbol);
    const targets = buildTargets(orderSide, snapshot.price, config.risk);

    return {
        status: 'executed',
        order: orderDetails,
        paperState: orderResult?.paperState || status?.paperState,
        account: status,
        targets,
        analysis: {
            decision: baseDecision,
            indicators,
            market: snapshot,
        },
        risk,
    };
}

async function performStream(config, exchange) {
    if (typeof exchange.streamMarket !== 'function') {
        throw new Error(`Provider ${config.exchange.provider} does not support streaming subscriptions`);
    }

    const streamOptions = {
        channel: config.stream?.channel || 'bookTicker',
        interval: config.stream?.interval || config.interval || '1m',
        limit: config.stream?.limit || config.stream?.messageLimit || 20,
        durationMs: config.stream?.durationMs || config.stream?.windowMs || 5000,
    };

    const stream = await exchange.streamMarket(config.symbol, streamOptions);

    return {
        status: 'streamed',
        stream,
        metadata: {
            provider: config.exchange.provider,
            channel: streamOptions.channel,
            messageLimit: streamOptions.limit,
            durationMs: streamOptions.durationMs,
        },
    };
}

async function fetchStatus(config, exchange) {
    const status = await exchange.getAccountSnapshot(config.symbol);
    return { status: 'ok', account: status };
}

async function cancelOrder(config, exchange) {
    if (!config.execution.orderId && !config.execution.clientOrderId) {
        throw new Error('Provide execution.orderId or execution.clientOrderId for cancel action');
    }

    const result = await exchange.cancelOrder({
        symbol: config.symbol,
        orderId: config.execution.orderId,
        origClientOrderId: config.execution.clientOrderId,
    });

    return { status: 'cancelled', order: result?.order || result, paperState: result?.paperState };
}

async function runBacktest(config, exchange) {
    const data = config.backtest?.candles || (await exchange.getHistoricalCandles(config.symbol, config.interval, config.candleLimit * 5));
    if (!Array.isArray(data) || data.length < 20) {
        throw new Error('Not enough candles for backtest');
    }

    const closes = data.map((c) => Number(c[4]));
    const strategy = config.strategy || {};
    const initialBalance = config.backtest?.capital || 10000;
    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let trades = [];

    for (let i = 20; i < data.length; i++) {
        const segment = data.slice(0, i + 1);
        const indicators = buildIndicators(segment, strategy);
        const decision = deriveDecision(indicators, config);
        const price = Number(segment[segment.length - 1][4]);

        if (decision.signal === 'long' && position <= 0) {
            if (position < 0) {
                balance += (entryPrice - price) * Math.abs(position);
                trades.push({ type: 'cover', price, size: Math.abs(position), balance });
                position = 0;
            }
            const qty = determineQuantity({ ...config, quantity: undefined, quoteQuantity: balance * config.risk.positionRiskPct }, price);
            if (qty > 0) {
                position += qty;
                entryPrice = price;
                balance -= price * qty;
                trades.push({ type: 'buy', price, size: qty, balance });
            }
        } else if (decision.signal === 'short' && position >= 0) {
            if (position > 0) {
                balance += (price - entryPrice) * position;
                trades.push({ type: 'sell', price, size: position, balance });
                position = 0;
            }
            if (config.risk.allowShort) {
                const qty = determineQuantity({ ...config, quantity: undefined, quoteQuantity: balance * config.risk.positionRiskPct }, price);
                if (qty > 0) {
                    position -= qty;
                    entryPrice = price;
                    trades.push({ type: 'short', price, size: qty, balance });
                }
            }
        }
    }

    const finalPrice = Number(data[data.length - 1][4]);
    const finalBalance = balance + position * finalPrice;
    const roi = (finalBalance - initialBalance) / initialBalance;

    return {
        status: 'completed',
        statistics: {
            trades: trades.length,
            finalBalance,
            roi,
            maxDrawdown: Math.abs(computeMaxDrawdown(trades, initialBalance)),
        },
        trades,
    };
}

function buildIndicators(candles, strategy) {
    const closes = candles.map((c) => Number(c[4]));
    const fast = strategy.fastLength || 9;
    const slow = strategy.slowLength || 26;
    const rsiPeriod = strategy.rsiLength || 14;
    const emaPeriod = strategy.emaLength || 21;
    const volatilityPeriod = strategy.volatilityLength || 20;
    const momentumLookback = strategy.momentumLookback || 5;

    const lastClose = closes.at(-1);
    const lookbackIndex = Math.max(closes.length - 1 - Math.min(momentumLookback, closes.length - 1), 0);
    const referencePrice = closes[lookbackIndex] ?? lastClose;

    return {
        price: lastClose,
        smaFast: simpleMovingAverage(closes, fast),
        smaSlow: simpleMovingAverage(closes, slow),
        ema: exponentialMovingAverage(closes, emaPeriod),
        rsi: relativeStrengthIndex(closes, rsiPeriod),
        volatility: rollingStdDev(closes, volatilityPeriod),
        momentum: lastClose - referencePrice,
        closes,
    };
}

function deriveDecision(indicators, config) {
    const strategyType = (config.strategy?.type || 'sma-crossover').toLowerCase();
    let signal = 'flat';
    let confidence = 0.5;
    let reason = 'Neutral';

    if (strategyType === 'sma-crossover') {
        if (indicators.smaFast > indicators.smaSlow) {
            signal = 'long';
            confidence = sigmoid(indicators.momentum || 0);
            reason = 'Fast SMA above slow SMA';
        } else if (indicators.smaFast < indicators.smaSlow) {
            signal = 'short';
            confidence = sigmoid(-(indicators.momentum || 0));
            reason = 'Fast SMA below slow SMA';
        }
    } else if (strategyType === 'rsi-mean-reversion') {
        const lower = config.strategy.lowerBand || 30;
        const upper = config.strategy.upperBand || 70;
        if (indicators.rsi < lower) {
            signal = 'long';
            confidence = 1 - indicators.rsi / lower;
            reason = `RSI ${indicators.rsi.toFixed(2)} below ${lower}`;
        } else if (indicators.rsi > upper && config.risk.allowShort) {
            signal = 'short';
            confidence = (indicators.rsi - upper) / (100 - upper);
            reason = `RSI ${indicators.rsi.toFixed(2)} above ${upper}`;
        }
    } else if (strategyType === 'momentum-breakout') {
        const momentum = indicators.momentum || 0;
        if (momentum > 0) {
            signal = 'long';
            confidence = sigmoid(momentum);
            reason = 'Positive momentum breakout';
        } else if (momentum < 0 && config.risk.allowShort) {
            signal = 'short';
            confidence = sigmoid(-momentum);
            reason = 'Negative momentum breakdown';
        }
    } else if (strategyType === 'manual') {
        signal = (config.strategy.manualSignal || 'flat').toLowerCase();
        confidence = config.strategy.confidence || 0.5;
        reason = config.strategy.reason || 'Manual override';
    }

    return { signal, confidence, reason };
}

function evaluateRisk(decision, config) {
    const reasons = [];
    const dailyLoss = toNumber(config.performance?.dailyLoss);
    if (dailyLoss !== undefined && config.risk.maxDailyLoss && dailyLoss <= -Math.abs(config.risk.maxDailyLoss)) {
        reasons.push(`Daily loss ${dailyLoss} exceeds limit ${config.risk.maxDailyLoss}`);
    }
    const drawdown = toNumber(config.performance?.drawdown);
    if (drawdown !== undefined && config.risk.maxDrawdown && Math.abs(drawdown) >= Math.abs(config.risk.maxDrawdown)) {
        reasons.push(`Drawdown ${drawdown} exceeds limit ${config.risk.maxDrawdown}`);
    }
    if (decision.signal === 'short' && !config.risk.allowShort) {
        reasons.push('Short trades disabled');
    }
    if (decision.signal === 'long' && !config.risk.allowLong) {
        reasons.push('Long trades disabled');
    }

    return {
        allowed: reasons.length === 0,
        reasons,
    };
}

function buildTargets(side, price, risk) {
    if (!price) return null;
    const stopPct = risk.stopLossPct || 0.01;
    const takePct = risk.takeProfitPct || 0.02;
    const stopLoss = side === 'BUY' ? price * (1 - stopPct) : price * (1 + stopPct);
    const takeProfit = side === 'BUY' ? price * (1 + takePct) : price * (1 - takePct);
    return {
        stopLoss,
        takeProfit,
        riskReward: takePct / stopPct,
    };
}

function determineQuantity(config, price) {
    if (config.quantity) {
        return sanitizePrecision(config.quantity, config.execution.quantityPrecision);
    }
    if (config.quoteQuantity) {
        return sanitizePrecision(config.quoteQuantity / price, config.execution.quantityPrecision);
    }

    const equity = config.performance?.equity || config.paperState?.balance || 10000;
    const notional = equity * (config.risk.positionRiskPct || 0.02) * (config.leverage || 1);
    let quantity = notional / price;
    if (config.risk.maxPositionSize) {
        quantity = Math.min(quantity, config.risk.maxPositionSize);
    }
    return sanitizePrecision(quantity, config.execution.quantityPrecision);
}



function simpleMovingAverage(values, period) {
    if (!values?.length || values.length < period) return values.at(-1);
    const subset = values.slice(-period);
    return subset.reduce((sum, v) => sum + v, 0) / period;
}

function exponentialMovingAverage(values, period) {
    if (!values?.length) return undefined;
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}

function relativeStrengthIndex(values, period) {
    if (!values || values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
}

function rollingStdDev(values, period) {
    if (!values || values.length < period) return 0;
    const subset = values.slice(-period);
    const mean = subset.reduce((sum, v) => sum + v, 0) / subset.length;
    const variance = subset.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / subset.length;
    return Math.sqrt(variance);
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function computeMaxDrawdown(trades, initialBalance) {
    if (!trades.length) return 0;
    let peak = initialBalance;
    let maxDD = 0;
    for (const trade of trades) {
        peak = Math.max(peak, trade.balance);
        const dd = (trade.balance - peak) / peak;
        maxDD = Math.min(maxDD, dd);
    }
    return maxDD;
}

execute;
