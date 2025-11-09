import { collectWebSocketFeed } from './websocket.js';

const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';
const BINANCE_SPOT_WS = 'wss://stream.binance.com:9443/ws';
const ASTER_FUTURES_WS = 'wss://fapi.asterdex.com/ws';
const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';

function buildBinanceStreamName(symbol, channel, interval = '1m') {
    const lowerSymbol = symbol.toLowerCase();
    switch (channel) {
        case 'ticker':
            return `${lowerSymbol}@ticker`;
        case 'trade':
            return `${lowerSymbol}@trade`;
        case 'kline':
            return `${lowerSymbol}@kline_${interval}`;
        case 'miniTicker':
            return `${lowerSymbol}@miniTicker`;
        case 'bookTicker':
        default:
            return `${lowerSymbol}@bookTicker`;
    }
}

export async function streamBinanceFeed({
    symbol,
    channel = 'bookTicker',
    interval = '1m',
    limit = 20,
    durationMs = 5000,
    market = 'futures',
    endpointOverride,
}) {
    const baseWs =
        endpointOverride ||
        (market === 'spot'
            ? BINANCE_SPOT_WS
            : market === 'aster'
            ? ASTER_FUTURES_WS
            : BINANCE_FUTURES_WS);
    const streamName = buildBinanceStreamName(symbol, channel, interval);
    const url = `${baseWs}/${streamName}`;

    const samples = await collectWebSocketFeed({
        url,
        messageLimit: limit,
        durationMs,
        transform: (raw) => {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return {
                eventTime: Number(parsed.E || parsed.eventTime || Date.now()),
                updateId: parsed.u || parsed.U || parsed.updateId || null,
                price: Number(parsed.c || parsed.p || parsed.P || parsed.price || 0),
                bestBid: Number(parsed.b || parsed.bestBidPrice || 0),
                bestAsk: Number(parsed.a || parsed.bestAskPrice || 0),
                volume: Number(parsed.v || parsed.volume || 0),
                raw: parsed,
            };
        },
    });

    return {
        provider: market === 'aster' ? 'aster' : 'binance',
        channel,
        symbol,
        samples,
        stats: {
            count: samples.length,
            durationMs,
        },
    };
}

export async function streamOkxFeed({
    symbol,
    channel = 'tickers',
    limit = 20,
    durationMs = 5000,
    market = 'swap',
}) {
    const upper = symbol.toUpperCase();
    const quotes = ['USDT', 'USDC', 'BTC', 'ETH'];
    const quote = quotes.find((q) => upper.endsWith(q)) || 'USDT';
    const base = upper.slice(0, upper.length - quote.length) || upper;
    const pair = `${base}-${quote}`;
    const instId = market === 'spot' ? pair : `${pair}-SWAP`;
    const args = [
        {
            channel,
            instId,
        },
    ];

    const samples = await collectWebSocketFeed({
        url: OKX_PUBLIC_WS,
        messageLimit: limit,
        durationMs,
        onOpen: (ws) => {
            ws.send(
                JSON.stringify({
                    op: 'subscribe',
                    args,
                }),
            );
        },
        transform: (raw) => {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return parsed;
        },
        shouldInclude: (message) => Array.isArray(message?.data) && message.data.length > 0,
    });

    const flattened = samples
        .map((item) => item.data || [])
        .flat()
        .map((data) => ({
            ts: Number(data.ts || Date.now()),
            price: Number(data.last || data.lastPx || 0),
            bestBid: Number(data.bidPx || 0),
            bestAsk: Number(data.askPx || 0),
            volume24h: Number(data.vol24h || 0),
            raw: data,
        }));

    return {
        provider: 'okx',
        channel,
        symbol,
        samples: flattened,
        stats: {
            count: flattened.length,
            durationMs,
        },
    };
}
