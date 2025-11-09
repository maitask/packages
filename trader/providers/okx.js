import { OKX_BASE_URL } from '../shared/constants.js';
import { sanitizePrecision } from '../shared/utils.js';
import { streamOkxFeed } from '../shared/streaming.js';

function formatInstrument(symbol, market = 'swap') {
    const upper = symbol.toUpperCase();
    const quotes = ['USDT', 'USDC', 'BTC', 'ETH'];
    const quote = quotes.find((q) => upper.endsWith(q));
    if (!quote) {
        throw new Error(`Unable to derive OKX instrument from symbol ${symbol}`);
    }
    const base = upper.slice(0, upper.length - quote.length);
    const pair = `${base}-${quote}`;
    if (market === 'spot') return pair;
    return `${pair}-SWAP`;
}

function convertInterval(interval) {
    const map = {
        '1m': '1m',
        '3m': '3m',
        '5m': '5m',
        '15m': '15m',
        '30m': '30m',
        '1h': '1H',
        '2h': '2H',
        '4h': '4H',
        '6h': '6H',
        '12h': '12H',
        '1d': '1D',
    };
    return map[interval] || '5m';
}

async function hmacBase64(secret, payload) {
    if (globalThis.crypto?.subtle) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
        const bytes = new Uint8Array(signature);
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        if (typeof btoa === 'function') {
            let binary = '';
            bytes.forEach((b) => {
                binary += String.fromCharCode(b);
            });
            return btoa(binary);
        }
        throw new Error('No base64 encoder available for OKX signing');
    }
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', secret).update(payload).digest('base64');
}

async function okxRequest(config, method, path, searchParams = {}, body = undefined) {
    if (!config.apiKey || !config.apiSecret || !config.passphrase) {
        throw new Error('OKX requires apiKey, apiSecret, and passphrase');
    }

    const query = new URLSearchParams(searchParams).toString();
    const requestPath = query ? `${path}?${query}` : path;
    const url = `${OKX_BASE_URL}${requestPath}`;
    const timestamp = new Date().toISOString();
    const payload = body ? JSON.stringify(body) : '';
    const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${payload}`;
    const signature = await hmacBase64(config.apiSecret, prehash);

    const headers = {
        'OK-ACCESS-KEY': config.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': config.passphrase,
        'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
        method,
        headers,
        body: payload || undefined,
    });
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (err) {
        throw new Error(`OKX response parse error: ${err.message}`);
    }
    if (data.code !== '0') {
        throw new Error(`OKX API error ${data.code}: ${data.msg || 'unknown'}`);
    }
    return data.data;
}

function normalizeSymbol(symbol, market) {
    return formatInstrument(symbol, market);
}

function buildTickerPrice(ticker) {
    if (!ticker || !ticker.length) return null;
    const entry = ticker[0];
    return Number(entry.last || entry.lastPx || entry.lastTradedPx);
}

export function createOkxClient(config) {
    const market = (config.market || 'swap').toLowerCase();
    const instIdFromSymbol = (symbol) => normalizeSymbol(symbol, market);

    return {
        mode: `okx-${market}`,
        async getMarketSnapshot(symbol, interval, limit) {
            const instId = instIdFromSymbol(symbol);
            const bar = convertInterval(interval);
            const [candles, ticker] = await Promise.all([
                okxRequest(config, 'GET', '/api/v5/market/candles', { instId, bar, limit }),
                okxRequest(config, 'GET', '/api/v5/market/ticker', { instId }),
            ]);
            const candleData = candles
                .map((c) => [
                    Number(c[0]),
                    Number(c[1]),
                    Number(c[2]),
                    Number(c[3]),
                    Number(c[4]),
                    Number(c[5]),
                ])
                .reverse();
            return {
                symbol,
                price: buildTickerPrice(ticker),
                fundingRate: null,
                markPrice: buildTickerPrice(ticker),
                candles: candleData,
            };
        },
        async getHistoricalCandles(symbol, interval, limit) {
            const instId = instIdFromSymbol(symbol);
            const bar = convertInterval(interval);
            const candles = await okxRequest(config, 'GET', '/api/v5/market/candles', { instId, bar, limit });
            return candles
                .map((c) => [
                    Number(c[0]),
                    Number(c[1]),
                    Number(c[2]),
                    Number(c[3]),
                    Number(c[4]),
                    Number(c[5]),
                ])
                .reverse();
        },
        async placeOrder(payload) {
            const instId = instIdFromSymbol(payload.symbol);
            const ordType = payload.type === 'LIMIT' ? 'limit' : 'market';
            const side = payload.side === 'BUY' ? 'buy' : 'sell';
            const body = {
                instId,
                tdMode: config.tdMode || 'cross',
                side,
                ordType,
                sz: sanitizePrecision(payload.quantity, payload.quantityPrecision)?.toString() || `${payload.quantity}`,
            };
            if (market !== 'spot') {
                body.posSide = payload.positionSide === 'LONG' ? 'long' : 'short';
            }
            if (ordType === 'limit' && payload.price) {
                body.px = payload.price.toString();
            }
            if (payload.clientOrderId) {
                body.clOrdId = payload.clientOrderId;
            }
            const result = await okxRequest(config, 'POST', '/api/v5/trade/order', {}, body);
            return result?.[0] || result;
        },
        async getAccountSnapshot(symbol) {
            const instId = instIdFromSymbol(symbol);
            const balances = await okxRequest(config, 'GET', '/api/v5/account/balances');
            const positions = market === 'spot'
                ? []
                : await okxRequest(config, 'GET', '/api/v5/account/positions', { instId });
            return {
                balance: Number(balances?.[0]?.details?.[0]?.cashBal || 0),
                equity: Number(balances?.[0]?.details?.[0]?.eq || 0),
                positions,
            };
        },
        async cancelOrder(params) {
            const instId = instIdFromSymbol(params.symbol);
            const body = {
                instId,
            };
            if (params.orderId) {
                body.ordId = params.orderId;
            } else if (params.clientOrderId || params.origClientOrderId) {
                body.clOrdId = params.clientOrderId || params.origClientOrderId;
            }
            const result = await okxRequest(config, 'POST', '/api/v5/trade/cancel-order', {}, body);
            return result?.[0] || result;
        },
        async streamMarket(symbol, options = {}) {
            return streamOkxFeed({
                symbol,
                channel: options.channel || 'tickers',
                limit: options.limit,
                durationMs: options.durationMs,
                market,
            });
        },
    };
}
