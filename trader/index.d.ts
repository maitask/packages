export interface TraderStrategy {
    type?: 'sma-crossover' | 'rsi-mean-reversion' | 'momentum-breakout' | 'manual';
    fastLength?: number;
    slowLength?: number;
    emaLength?: number;
    rsiLength?: number;
    volatilityLength?: number;
    momentumLookback?: number;
    lowerBand?: number;
    upperBand?: number;
    manualSignal?: 'long' | 'short' | 'flat';
    confidence?: number;
    reason?: string;
}

export interface TraderRiskConfig {
    maxDailyLoss?: number;
    maxDrawdown?: number;
    maxPositionSize?: number;
    positionRiskPct?: number;
    slippageBps?: number;
    stopLossPct?: number;
    takeProfitPct?: number;
    allowShort?: boolean;
    allowLong?: boolean;
}

export interface TraderExchangeConfig {
    provider?: 'binance' | 'aster' | 'okx' | 'paper';
    market?: 'futures' | 'spot' | 'swap';
    testnet?: boolean;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string; // OKX
    recvWindow?: number;
}

export interface TraderStreamConfig {
    channel?: 'bookTicker' | 'ticker' | 'miniTicker' | 'trade' | 'kline';
    interval?: string;
    limit?: number;
    durationMs?: number;
}

export interface TraderPaperState {
    balance: number;
    positions: Array<{ symbol: string; quantity: number; entryPrice: number }>;
    orders: Array<{ id: string; symbol: string; side: string; price: number; quantity: number; timestamp: number }>;
    equityCurve: Array<{ time: number; balance: number; equity?: number }>;
    marks?: Record<string, number>;
}

export interface TraderInput {
    action?: 'analyze' | 'execute' | 'status' | 'cancel' | 'backtest' | 'stream';
    symbol?: string;
    interval?: string;
    candles?: number;
    strategy?: TraderStrategy;
    decision?: { signal: 'long' | 'short' | 'flat'; confidence?: number; reason?: string };
    quantity?: number;
    quoteQuantity?: number;
    price?: number;
    leverage?: number;
    execution?: {
        type?: 'MARKET' | 'LIMIT';
        reduceOnly?: boolean;
        timeInForce?: 'GTC' | 'IOC' | 'FOK';
        orderId?: string;
        clientOrderId?: string;
        quantityPrecision?: number;
    };
    risk?: TraderRiskConfig;
    performance?: {
        dailyLoss?: number;
        drawdown?: number;
        equity?: number;
    };
    exchange?: TraderExchangeConfig;
    paperState?: TraderPaperState;
    backtest?: {
        candles?: any[];
        capital?: number;
    };
    stream?: TraderStreamConfig;
}

export interface TraderOptions extends TraderInput {}

export interface TraderContext {
    secrets?: Record<string, string>;
}

export declare function execute(input?: TraderInput, options?: TraderOptions, context?: TraderContext): Promise<any>;
