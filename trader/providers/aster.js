import { ASTER_FUTURES_URL } from '../shared/constants.js';
import { handleJSON, normalizeParams, sanitizePrecision, signPayload } from '../shared/utils.js';
import { streamBinanceFeed } from '../shared/streaming.js';

function createPrivateRequest(config) {
    if (!config.apiKey || !config.apiSecret) {
        return null;
    }

    return async function request(method, path, params = {}) {
        const timestamp = Date.now();
        const query = new URLSearchParams({
            ...normalizeParams(params),
            timestamp,
            recvWindow: params.recvWindow || config.recvWindow || 5000,
        }).toString();

        const signature = await signPayload(config.apiSecret, query);
        const url = `${ASTER_FUTURES_URL}${path}?${query}&signature=${signature}`;
        const response = await fetch(url, {
            method,
            headers: {
                'X-MBX-APIKEY': config.apiKey,
            },
        });
        return handleJSON(response);
    };
}

function publicFetcher() {
    return async function get(path, params = {}) {
        const qs = new URLSearchParams(normalizeParams(params)).toString();
        const url = qs ? `${ASTER_FUTURES_URL}${path}?${qs}` : `${ASTER_FUTURES_URL}${path}`;
        const response = await fetch(url);
        return handleJSON(response);
    };
}

export function createAsterClient(config) {
    const privateRequest = createPrivateRequest(config);
    const publicGet = publicFetcher();

    return {
        mode: 'aster-futures',
        async getMarketSnapshot(symbol, interval, limit) {
            const [candles, ticker] = await Promise.all([
                publicGet('/fapi/v1/klines', { symbol, interval, limit }),
                publicGet('/fapi/v1/ticker/price', { symbol }),
            ]);
            return {
                symbol,
                price: Number(ticker.price),
                fundingRate: null,
                markPrice: Number(ticker.price),
                candles,
            };
        },
        async getHistoricalCandles(symbol, interval, limit) {
            return publicGet('/fapi/v1/klines', { symbol, interval, limit });
        },
        async placeOrder(payload) {
            if (!privateRequest) {
                throw new Error('Aster credentials not provided');
            }
            const params = {
                symbol: payload.symbol,
                side: payload.side,
                type: payload.type,
                quantity: sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity,
                reduceOnly: payload.reduceOnly,
                positionSide: payload.positionSide,
                timeInForce: payload.timeInForce,
            };
            if (payload.type === 'LIMIT' && payload.price) {
                params.price = payload.price;
            }
            return privateRequest('POST', '/fapi/v1/order', params);
        },
        async getAccountSnapshot(symbol) {
            if (!privateRequest) {
                throw new Error('Aster credentials not provided');
            }
            const account = await privateRequest('GET', '/fapi/v2/account');
            const position = account.positions?.find((p) => p.symbol === symbol) || null;
            return {
                balance: Number(account.totalWalletBalance),
                equity: Number(account.totalMarginBalance),
                positions: account.positions || [],
                selectedPosition: position,
            };
        },
        async cancelOrder(params) {
            if (!privateRequest) {
                throw new Error('Aster credentials not provided');
            }
            return privateRequest('DELETE', '/fapi/v1/order', params);
        },
        async streamMarket(symbol, options = {}) {
            return streamBinanceFeed({
                symbol,
                channel: options.channel,
                interval: options.interval,
                limit: options.limit,
                durationMs: options.durationMs,
                market: 'aster',
                endpointOverride: 'wss://fapi.asterdex.com/ws',
            });
        },
    };
}
