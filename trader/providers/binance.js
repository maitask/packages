import {
    BINANCE_FUTURES_URL,
    BINANCE_FUTURES_TESTNET_URL,
    BINANCE_SPOT_URL,
    BINANCE_SPOT_TESTNET_URL,
} from '../shared/constants.js';
import { handleJSON, normalizeParams, sanitizePrecision, signPayload } from '../shared/utils.js';
import { streamBinanceFeed } from '../shared/streaming.js';

function createPrivateRequest(baseUrl, config) {
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
        const url = `${baseUrl}${path}?${query}&signature=${signature}`;
        const response = await fetch(url, {
            method,
            headers: {
                'X-MBX-APIKEY': config.apiKey,
            },
        });
        return handleJSON(response);
    };
}

function publicFetcher(baseUrl) {
    return async function get(path, params = {}) {
        const qs = new URLSearchParams(normalizeParams(params)).toString();
        const url = qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;
        const response = await fetch(url);
        return handleJSON(response);
    };
}

function createFuturesClient(config) {
    const baseUrl = config.testnet ? BINANCE_FUTURES_TESTNET_URL : BINANCE_FUTURES_URL;
    const privateRequest = createPrivateRequest(baseUrl, config);
    const publicGet = publicFetcher(baseUrl);

    return {
        mode: 'binance-futures',
        async getMarketSnapshot(symbol, interval, limit) {
            const [candles, ticker, funding] = await Promise.all([
                publicGet('/fapi/v1/klines', { symbol, interval, limit }),
                publicGet('/fapi/v2/ticker/price', { symbol }),
                publicGet('/fapi/v1/premiumIndex', { symbol }).catch(() => ({})),
            ]);
            return {
                symbol,
                price: Number(ticker.price),
                fundingRate: funding?.lastFundingRate ? Number(funding.lastFundingRate) : null,
                markPrice: funding?.markPrice ? Number(funding.markPrice) : Number(ticker.price),
                candles,
            };
        },
        async getHistoricalCandles(symbol, interval, limit) {
            return publicGet('/fapi/v1/klines', { symbol, interval, limit });
        },
        async placeOrder(payload) {
            if (!privateRequest) {
                throw new Error('Binance futures credentials not provided');
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
                throw new Error('Binance futures credentials not provided');
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
                throw new Error('Binance futures credentials not provided');
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
                market: 'futures',
            });
        },
    };
}

function createSpotClient(config) {
    const baseUrl = config.testnet ? BINANCE_SPOT_TESTNET_URL : BINANCE_SPOT_URL;
    const privateRequest = createPrivateRequest(baseUrl, config);
    const publicGet = publicFetcher(baseUrl);

    function detectQuoteAsset(symbol) {
        const upper = symbol.toUpperCase();
        const candidates = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB'];
        for (const quote of candidates) {
            if (upper.endsWith(quote)) {
                return { quote, base: upper.slice(0, upper.length - quote.length) };
            }
        }
        return { quote: 'USDT', base: upper.replace('USDT', '') };
    }

    return {
        mode: 'binance-spot',
        async getMarketSnapshot(symbol, interval, limit) {
            const [candles, ticker] = await Promise.all([
                publicGet('/api/v3/klines', { symbol, interval, limit }),
                publicGet('/api/v3/ticker/price', { symbol }),
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
            return publicGet('/api/v3/klines', { symbol, interval, limit });
        },
        async placeOrder(payload) {
            if (!privateRequest) {
                throw new Error('Binance spot credentials not provided');
            }
            const params = {
                symbol: payload.symbol,
                side: payload.side,
                type: payload.type,
            };

            if (payload.type === 'MARKET' && payload.quoteQuantity) {
                params.quoteOrderQty = payload.quoteQuantity;
            } else {
                params.quantity = sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity;
            }

            if (payload.type === 'LIMIT') {
                params.timeInForce = payload.timeInForce || 'GTC';
                params.price = payload.price;
            }

            return privateRequest('POST', '/api/v3/order', params);
        },
        async getAccountSnapshot(symbol) {
            if (!privateRequest) {
                throw new Error('Binance spot credentials not provided');
            }
            const account = await privateRequest('GET', '/api/v3/account');
            const { quote } = detectQuoteAsset(symbol);
            const balances = account.balances
                .map((b) => ({
                    asset: b.asset,
                    free: Number(b.free),
                    locked: Number(b.locked),
                }))
                .filter((b) => b.free + b.locked > 0);
            const quoteBalance = balances.find((b) => b.asset === quote)?.free || 0;
            return {
                balance: quoteBalance,
                equity: quoteBalance,
                balances,
                positions: balances,
            };
        },
        async cancelOrder(params) {
            if (!privateRequest) {
                throw new Error('Binance spot credentials not provided');
            }
            return privateRequest('DELETE', '/api/v3/order', params);
        },
        async streamMarket(symbol, options = {}) {
            return streamBinanceFeed({
                symbol,
                channel: options.channel,
                interval: options.interval,
                limit: options.limit,
                durationMs: options.durationMs,
                market: 'spot',
            });
        },
    };
}

export function createBinanceClient(config) {
    const market = (config.market || 'futures').toLowerCase();
    if (market === 'spot') {
        return createSpotClient(config);
    }
    return createFuturesClient(config);
}
