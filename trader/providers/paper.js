import { BINANCE_FUTURES_URL } from '../shared/constants.js';
import { handleJSON, normalizeParams, sanitizePrecision } from '../shared/utils.js';
import { buildDefaultPaperState } from '../shared/state.js';

async function fetchBinancePublic(path, params) {
    const qs = new URLSearchParams(normalizeParams(params)).toString();
    const url = qs ? `${BINANCE_FUTURES_URL}${path}?${qs}` : `${BINANCE_FUTURES_URL}${path}`;
    const response = await fetch(url);
    return handleJSON(response);
}

export function createPaperClient(config) {
    const baseState = config.runtime?.paperState || buildDefaultPaperState();
    const state = JSON.parse(JSON.stringify(baseState));

    async function ensureMark(symbol) {
        if (!state.marks) {
            state.marks = {};
        }
        if (!state.marks[symbol]) {
            const ticker = await fetchBinancePublic('/fapi/v2/ticker/price', { symbol }).catch(() => ({ price: state.lastMarkPrice || 0 }));
            state.marks[symbol] = Number(ticker.price) || state.lastMarkPrice || 0;
        }
        return state.marks[symbol];
    }

    return {
        mode: 'paper',
        async getMarketSnapshot(symbol, interval, limit) {
            const [candles, ticker] = await Promise.all([
                fetchBinancePublic('/fapi/v1/klines', { symbol, interval, limit }),
                fetchBinancePublic('/fapi/v2/ticker/price', { symbol }),
            ]);
            state.lastMarkPrice = Number(ticker.price);
            state.marks = state.marks || {};
            state.marks[symbol] = state.lastMarkPrice;
            return {
                symbol,
                price: state.lastMarkPrice,
                fundingRate: null,
                markPrice: state.lastMarkPrice,
                candles,
            };
        },
        async getHistoricalCandles(symbol, interval, limit) {
            return fetchBinancePublic('/fapi/v1/klines', { symbol, interval, limit });
        },
        async placeOrder(payload) {
            const fallbackPrice = payload.referencePrice || payload.price || 0;
            const mark = await ensureMark(payload.symbol) || fallbackPrice;
            const price = payload.type === 'MARKET' ? mark : (payload.price || mark || fallbackPrice);
            if (!price || price <= 0) {
                throw new Error('Unable to determine fill price for paper trade');
            }
            const fillQty = sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity;
            if (!fillQty || fillQty <= 0) {
                throw new Error('Invalid paper quantity');
            }

            let position = state.positions.find((p) => p.symbol === payload.symbol);
            if (!position) {
                position = { symbol: payload.symbol, quantity: 0, entryPrice: price };
                state.positions.push(position);
            }

            const direction = payload.side === 'BUY' ? 1 : -1;
            const prevQty = position.quantity;
            const tradeQty = direction * fillQty;
            let closingQty = 0;
            let realizedPnl = 0;

            if (prevQty !== 0 && Math.sign(prevQty) !== Math.sign(tradeQty)) {
                closingQty = Math.min(Math.abs(prevQty), Math.abs(tradeQty));
                realizedPnl = (price - position.entryPrice) * closingQty * Math.sign(prevQty);
                position.quantity = prevQty - Math.sign(prevQty) * closingQty;
            }

            const tradeSign = tradeQty === 0 ? 0 : Math.sign(tradeQty);
            const remainingQty = tradeQty - tradeSign * closingQty;
            if (remainingQty !== 0) {
                const newQty = position.quantity + remainingQty;
                const weightPrev = Math.abs(position.quantity);
                const weightNew = Math.abs(remainingQty);
                position.entryPrice = (weightPrev * position.entryPrice + weightNew * price) / (weightPrev + weightNew || 1);
                position.quantity = newQty;
            }

            if (position.quantity === 0) {
                position.entryPrice = price;
            }

            state.balance += realizedPnl;
            const equity = state.balance + state.positions.reduce((sum, pos) => {
                const markPrice = state.marks?.[pos.symbol] ?? state.lastMarkPrice ?? price;
                return sum + pos.quantity * markPrice;
            }, 0);

            const order = {
                id: `paper-${Date.now()}`,
                status: 'FILLED',
                price,
                quantity: fillQty,
                side: payload.side,
                symbol: payload.symbol,
                timestamp: Date.now(),
                realizedPnl,
                equity,
            };

            state.orders.push(order);
            state.equityCurve.push({ time: Date.now(), balance: state.balance, equity });

            return { order, paperState: state };
        },
        async getAccountSnapshot(symbol) {
            const markMap = state.marks || {};
            const equity = state.balance + state.positions.reduce((sum, pos) => {
                const mark = markMap[pos.symbol] || state.lastMarkPrice || pos.entryPrice;
                return sum + pos.quantity * mark;
            }, 0);
            return {
                balance: state.balance,
                equity,
                positions: state.positions,
                orders: state.orders.slice(-20),
                paperState: state,
            };
        },
        async cancelOrder(params) {
            state.orders = state.orders.filter((o) => o.id !== params.orderId && o.clientOrderId !== params.origClientOrderId);
            return { cancelled: true, paperState: state };
        },
        async streamMarket(symbol, options = {}) {
            const limit = options.limit || 20;
            const intervalMs = Math.max((options.durationMs || 5000) / limit, 50);
            const samples = [];
            let last = state.marks?.[symbol] ?? state.lastMarkPrice ?? 1000;

            for (let i = 0; i < limit; i++) {
                const delta = (Math.random() - 0.5) * (last * 0.001);
                last = Math.max(0.0001, last + delta);
                samples.push({
                    eventTime: Date.now(),
                    price: Number(last.toFixed(4)),
                    bestBid: Number((last - 0.5 * Math.abs(delta)).toFixed(4)),
                    bestAsk: Number((last + 0.5 * Math.abs(delta)).toFixed(4)),
                });
            }

            await new Promise((resolve) => setTimeout(resolve, intervalMs * limit));

            return {
                provider: 'paper',
                channel: options.channel || 'simulated',
                symbol,
                samples,
                stats: {
                    count: samples.length,
                    durationMs: intervalMs * limit,
                },
            };
        },
    };
}
