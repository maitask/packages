export type TraderAction =
  | 'marketSnapshot'
  | 'analyze'
  | 'backtest'
  | 'paperOrder'
  | 'accountSnapshot'
  | 'cancelOrder'
  | 'placeOrder';

export type TraderProvider = 'binance' | 'aster' | 'okx';
export type TraderInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '3d' | '1w';
export type TraderDecimal = string;

export interface TraderCandle {
  readonly openTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface BinanceSpotExchange {
  readonly provider: 'binance';
  readonly market: 'spot';
  readonly environment: 'testnet' | 'mainnet';
}

export interface BinanceFuturesExchange {
  readonly provider: 'binance';
  readonly market: 'futures';
  readonly environment: 'testnet' | 'mainnet';
}

export interface AsterFuturesExchange {
  readonly provider: 'aster';
  readonly market: 'futures';
  readonly environment: 'mainnet';
}

export interface OkxSpotExchange {
  readonly provider: 'okx';
  readonly market: 'spot';
  readonly environment: 'testnet' | 'mainnet';
}

export interface OkxSwapExchange {
  readonly provider: 'okx';
  readonly market: 'swap';
  readonly environment: 'testnet' | 'mainnet';
}

export type TraderExchange =
  | BinanceSpotExchange
  | BinanceFuturesExchange
  | AsterFuturesExchange
  | OkxSpotExchange
  | OkxSwapExchange;

export type TraderTestnetExchange =
  | (BinanceSpotExchange & { readonly environment: 'testnet' })
  | (BinanceFuturesExchange & { readonly environment: 'testnet' })
  | (OkxSpotExchange & { readonly environment: 'testnet' })
  | (OkxSwapExchange & { readonly environment: 'testnet' });

export type TraderMainnetExchange =
  | (BinanceSpotExchange & { readonly environment: 'mainnet' })
  | (BinanceFuturesExchange & { readonly environment: 'mainnet' })
  | AsterFuturesExchange
  | (OkxSpotExchange & { readonly environment: 'mainnet' })
  | (OkxSwapExchange & { readonly environment: 'mainnet' });

interface TraderStrategyParameters {
  readonly fastLength?: number;
  readonly slowLength?: number;
  readonly emaLength?: number;
  readonly rsiLength?: number;
  readonly lowerBand?: number;
  readonly upperBand?: number;
  readonly volatilityLength?: number;
  readonly momentumLookback?: number;
}

export type TraderStrategy =
  | (TraderStrategyParameters & {
      readonly type?: 'smaCrossover';
      readonly manualSignal?: never;
      readonly confidence?: never;
      readonly reason?: never;
    })
  | (TraderStrategyParameters & {
      readonly type: 'rsiMeanReversion' | 'momentum';
      readonly manualSignal?: never;
      readonly confidence?: never;
      readonly reason?: never;
    })
  | (TraderStrategyParameters & {
      readonly type: 'manual';
      readonly manualSignal: 'long' | 'short' | 'flat';
      readonly confidence?: number;
      readonly reason?: string;
    });

export interface TraderSimulation {
  readonly initialCapital?: number;
  readonly positionFraction?: number;
  readonly feeBps?: number;
  readonly slippageBps?: number;
  readonly allowLong?: boolean;
  readonly allowShort?: boolean;
}

interface TraderBaseInput {
  readonly symbol: string;
}

export interface TraderMarketSnapshotInput extends TraderBaseInput {
  readonly action: 'marketSnapshot';
  readonly interval: TraderInterval;
  readonly limit?: number;
  readonly exchange: TraderExchange;
}

export interface TraderAnalyzeInput extends TraderBaseInput {
  readonly action: 'analyze';
  readonly interval: TraderInterval;
  readonly candles: readonly TraderCandle[];
  readonly strategy?: TraderStrategy;
}

export interface TraderBacktestInput extends TraderBaseInput {
  readonly action: 'backtest';
  readonly interval: TraderInterval;
  readonly candles: readonly TraderCandle[];
  readonly strategy?: TraderStrategy;
  readonly simulation?: TraderSimulation;
}

interface TraderOrderCommon {
  readonly side: 'buy' | 'sell';
  readonly clientOrderId?: string;
}

export interface TraderMarketQuantityOrder extends TraderOrderCommon {
  readonly type: 'market';
  readonly quantity: TraderDecimal;
  readonly quoteQuantity?: never;
  readonly price?: never;
  readonly timeInForce?: never;
}

export interface TraderMarketQuoteOrder extends TraderOrderCommon {
  readonly type: 'market';
  readonly quantity?: never;
  readonly quoteQuantity: TraderDecimal;
  readonly price?: never;
  readonly timeInForce?: never;
}

export interface TraderLimitOrder extends TraderOrderCommon {
  readonly type: 'limit';
  readonly quantity: TraderDecimal;
  readonly quoteQuantity?: never;
  readonly price: TraderDecimal;
  readonly timeInForce: 'GTC' | 'IOC' | 'FOK';
}

export type TraderSpotOrder =
  | (TraderMarketQuantityOrder & { readonly reduceOnly?: never; readonly positionSide?: never })
  | (TraderMarketQuoteOrder & { readonly reduceOnly?: never; readonly positionSide?: never })
  | (TraderLimitOrder & { readonly reduceOnly?: never; readonly positionSide?: never });

type TraderDerivativeDirection =
  | { readonly reduceOnly: true; readonly positionSide?: never }
  | { readonly reduceOnly?: false; readonly positionSide?: 'long' | 'short' };

export type TraderDerivativeOrder =
  | (TraderMarketQuantityOrder & TraderDerivativeDirection)
  | (TraderLimitOrder & TraderDerivativeDirection);

type OkxSwapDirection =
  | { readonly reduceOnly: true; readonly positionSide?: never }
  | { readonly reduceOnly?: false; readonly positionSide: 'long' | 'short' };

export type OkxSwapOrder =
  | (TraderMarketQuantityOrder & OkxSwapDirection)
  | (TraderLimitOrder & OkxSwapDirection);

export type TraderPaperOrder =
  | (TraderMarketQuantityOrder & { readonly reduceOnly?: boolean; readonly positionSide?: never })
  | (TraderLimitOrder & { readonly reduceOnly?: boolean; readonly positionSide?: never });

export type TraderCancelIdentifier =
  | { readonly orderId: string; readonly clientOrderId?: never }
  | { readonly orderId?: never; readonly clientOrderId: string };

export interface TraderPaperPosition {
  readonly symbol: string;
  readonly side: 'long' | 'short';
  readonly quantity: TraderDecimal;
  readonly entryPrice: TraderDecimal;
  readonly reservedNotional: TraderDecimal;
}

export interface TraderPaperReceipt {
  readonly id: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly type: 'market' | 'limit';
  readonly quantity: TraderDecimal;
  readonly fillPrice: TraderDecimal | null;
  readonly fee: TraderDecimal;
  readonly status: 'open' | 'filled';
  readonly simulated: true;
  readonly createdAt: string;
}

export interface TraderEquityPoint {
  readonly time: number;
  readonly equity: TraderDecimal;
}

export interface TraderPaperState {
  readonly version: 1;
  readonly quoteBalance: TraderDecimal;
  readonly positions: readonly TraderPaperPosition[];
  readonly orders: readonly TraderPaperReceipt[];
  readonly realizedPnl: TraderDecimal;
  readonly feesPaid: TraderDecimal;
  readonly equityHistory: readonly TraderEquityPoint[];
}

export interface TraderPaperOrderInput extends TraderBaseInput {
  readonly action: 'paperOrder';
  readonly referencePrice: TraderDecimal;
  readonly eventTime: number;
  readonly order: TraderPaperOrder;
  readonly simulation?: TraderSimulation;
  readonly paperState: TraderPaperState;
}

export interface TraderAccountSnapshotInput<E extends TraderExchange = TraderExchange> extends TraderBaseInput {
  readonly action: 'accountSnapshot';
  readonly exchange: E;
}

export interface TraderCancelOrderInput<E extends TraderExchange = TraderExchange> extends TraderBaseInput {
  readonly action: 'cancelOrder';
  readonly exchange: E;
  readonly order: TraderCancelIdentifier;
}

export type TraderPlaceOrderInput<E extends TraderExchange = TraderExchange> =
  E extends BinanceSpotExchange
    ? TraderBaseInput & { readonly action: 'placeOrder'; readonly exchange: E; readonly order: TraderSpotOrder }
    : E extends OkxSpotExchange
      ? TraderBaseInput & {
          readonly action: 'placeOrder';
          readonly exchange: E;
          readonly order: Exclude<TraderSpotOrder, TraderMarketQuoteOrder>;
        }
      : E extends OkxSwapExchange
        ? TraderBaseInput & { readonly action: 'placeOrder'; readonly exchange: E; readonly order: OkxSwapOrder }
        : TraderBaseInput & { readonly action: 'placeOrder'; readonly exchange: E; readonly order: TraderDerivativeOrder };

export type TraderInput =
  | TraderMarketSnapshotInput
  | TraderAnalyzeInput
  | TraderBacktestInput
  | TraderPaperOrderInput
  | TraderAccountSnapshotInput
  | TraderCancelOrderInput
  | TraderPlaceOrderInput;

export interface TraderOptions {
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly apiKeySecret?: string;
  readonly apiSecretSecret?: string;
  readonly passphraseSecret?: string;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly allowLiveTrading?: boolean;
  readonly allowMainnetTrading?: boolean;
}

export interface TraderTestnetMutationOptions extends TraderOptions {
  readonly allowLiveTrading: true;
}

export interface TraderMainnetMutationOptions extends TraderOptions {
  readonly allowLiveTrading: true;
  readonly allowMainnetTrading: true;
}

export interface TraderContext {
  readonly executionId?: string;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface TraderIndicatorParameters {
  readonly fastLength: number;
  readonly slowLength: number;
  readonly emaLength: number;
  readonly rsiLength: number;
  readonly volatilityLength: number;
  readonly momentumLookback: number;
}

export interface TraderIndicators {
  readonly price: number;
  readonly smaFast: number;
  readonly smaSlow: number;
  readonly ema: number;
  readonly rsi: number;
  readonly volatility: number;
  readonly momentum: number;
  readonly parameters: TraderIndicatorParameters;
}

export interface TraderRecommendation {
  readonly signal: 'long' | 'short' | 'flat';
  readonly confidence: number;
  readonly reason: string;
  readonly executionAuthorized: false;
}

export interface TraderMarketSnapshot {
  readonly action: 'marketSnapshot';
  readonly provider: TraderProvider;
  readonly market: 'spot' | 'futures' | 'swap';
  readonly environment: 'testnet' | 'mainnet';
  readonly symbol: string;
  readonly instrumentId?: string;
  readonly interval: TraderInterval;
  readonly price: number;
  readonly candles: readonly TraderCandle[];
}

export interface TraderAnalysis {
  readonly action: 'analyze';
  readonly symbol: string;
  readonly interval: TraderInterval;
  readonly candleCount: number;
  readonly indicators: TraderIndicators;
  readonly recommendation: TraderRecommendation;
}

export interface TraderBacktestTrade {
  readonly side: 'long' | 'short';
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly grossPnl: number;
  readonly fee: number;
  readonly netPnl: number;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly reason: 'signalChange' | 'endOfSeries';
}

export interface TraderBacktestResult {
  readonly action: 'backtest';
  readonly symbol: string;
  readonly interval: TraderInterval;
  readonly assumptions: Required<TraderSimulation>;
  readonly statistics: {
    readonly initialCapital: number;
    readonly finalCapital: number;
    readonly grossPnl: number;
    readonly netPnl: number;
    readonly fees: number;
    readonly return: number;
    readonly tradeCount: number;
    readonly wins: number;
    readonly losses: number;
    readonly winRate: number;
    readonly maximumDrawdown: number;
  };
  readonly trades: readonly TraderBacktestTrade[];
  readonly equityCurve: readonly { readonly time: number; readonly equity: number }[];
  readonly openPosition: null;
}

export interface TraderPaperOrderResult {
  readonly action: 'paperOrder';
  readonly mode: 'paper';
  readonly order: TraderPaperReceipt;
  readonly paperState: TraderPaperState;
}

export interface TraderLiveOrderReceipt {
  readonly provider: TraderProvider;
  readonly market: 'spot' | 'futures' | 'swap';
  readonly environment: 'testnet' | 'mainnet';
  readonly symbol: string;
  readonly instrumentId?: string;
  readonly orderId: string;
  readonly clientOrderId: string | null;
  readonly status: string;
  readonly side: 'buy' | 'sell';
  readonly type: 'market' | 'limit';
  readonly quantity: TraderDecimal | null;
  readonly quoteQuantity: TraderDecimal | null;
  readonly price: TraderDecimal | null;
  readonly averagePrice: TraderDecimal | null;
  readonly reduceOnly: boolean;
  readonly positionSide: 'long' | 'short' | null;
}

export interface TraderPlaceOrderResult {
  readonly action: 'placeOrder';
  readonly mode: 'live';
  readonly order: TraderLiveOrderReceipt;
}

export interface TraderCancellationReceipt {
  readonly provider: TraderProvider;
  readonly market: 'spot' | 'futures' | 'swap';
  readonly environment: 'testnet' | 'mainnet';
  readonly symbol: string;
  readonly instrumentId?: string;
  readonly orderId: string | null;
  readonly clientOrderId: string | null;
  readonly status: string;
  readonly cancelled: true;
}

export interface TraderCancelOrderResult {
  readonly action: 'cancelOrder';
  readonly mode: 'live';
  readonly cancellation: TraderCancellationReceipt;
}

export type TraderAccountBalance = Readonly<Record<string, TraderDecimal | string>> & {
  readonly asset: string;
};

export type TraderAccountPosition = Readonly<Record<string, TraderDecimal | string>>;

export interface TraderAccount {
  readonly totalWalletBalance?: TraderDecimal;
  readonly totalEquity: TraderDecimal | null;
  readonly availableBalance: TraderDecimal | null;
  readonly unrealizedPnl: TraderDecimal | null;
  readonly balances: readonly TraderAccountBalance[];
  readonly positions: readonly TraderAccountPosition[];
}

export interface TraderAccountSnapshotResult {
  readonly action: 'accountSnapshot';
  readonly mode: 'live';
  readonly provider: TraderProvider;
  readonly market: 'spot' | 'futures' | 'swap';
  readonly environment: 'testnet' | 'mainnet';
  readonly account: TraderAccount;
}

export type TraderActionData =
  | TraderMarketSnapshot
  | TraderAnalysis
  | TraderBacktestResult
  | TraderPaperOrderResult
  | TraderPlaceOrderResult
  | TraderCancelOrderResult
  | TraderAccountSnapshotResult;

export type TraderDataForInput<I extends TraderInput> =
  I extends TraderMarketSnapshotInput ? TraderMarketSnapshot
    : I extends TraderAnalyzeInput ? TraderAnalysis
      : I extends TraderBacktestInput ? TraderBacktestResult
        : I extends TraderPaperOrderInput ? TraderPaperOrderResult
          : I extends TraderAccountSnapshotInput ? TraderAccountSnapshotResult
            : I extends TraderCancelOrderInput ? TraderCancelOrderResult
              : TraderPlaceOrderResult;

export interface TraderSuccess<T extends TraderActionData> {
  readonly success: true;
  readonly data: {
    readonly items: readonly [{ readonly index: 0; readonly data: T }];
    readonly summary: { readonly total: 1; readonly success_count: 1; readonly failure_count: 0 };
  };
  readonly error: null;
  readonly metadata: TraderMetadata;
  readonly citations: readonly [];
}

export type TraderErrorCode =
  | 'TRADER_VALIDATION'
  | 'TRADER_SECRET_UNAVAILABLE'
  | 'TRADER_POLICY'
  | 'TRADER_TIMEOUT'
  | 'TRADER_RESPONSE_TOO_LARGE'
  | 'TRADER_REDIRECT'
  | 'TRADER_PROVIDER'
  | 'TRADER_UPSTREAM';

export interface TraderError {
  readonly message: string;
  readonly code: TraderErrorCode;
  readonly type:
    | 'ValidationError'
    | 'SecretUnavailableError'
    | 'PolicyError'
    | 'TimeoutError'
    | 'ResponseLimitError'
    | 'RedirectError'
    | 'ProviderError'
    | 'UpstreamError';
  readonly status?: number;
  readonly retriable?: boolean;
}

export interface TraderMetadata {
  readonly contractVersion: string;
  readonly package: '@maitask/trader';
  readonly version: string;
  readonly action: TraderAction | null;
  readonly provider: TraderProvider | null;
  readonly market: 'spot' | 'futures' | 'swap' | null;
  readonly environment: 'testnet' | 'mainnet' | null;
  readonly executionId: string | null;
  readonly attempts: number;
  readonly executedAt: string;
  readonly executionMs: number;
}

export interface TraderFailureResult {
  readonly success: false;
  readonly error: TraderError;
  readonly metadata: TraderMetadata;
  readonly citations: readonly [];
}

export type TraderResult<T extends TraderActionData = TraderActionData> = TraderSuccess<T> | TraderFailureResult;

export function execute<I extends TraderMarketSnapshotInput | TraderAnalyzeInput | TraderBacktestInput | TraderPaperOrderInput | TraderAccountSnapshotInput>(
  input: I,
  options?: TraderOptions,
  context?: TraderContext
): Promise<TraderResult<TraderDataForInput<I>>>;

export function execute<I extends TraderCancelOrderInput<TraderTestnetExchange> | TraderPlaceOrderInput<TraderTestnetExchange>>(
  input: I,
  options: TraderTestnetMutationOptions,
  context?: TraderContext
): Promise<TraderResult<TraderDataForInput<I>>>;

export function execute<I extends TraderCancelOrderInput<TraderMainnetExchange> | TraderPlaceOrderInput<TraderMainnetExchange>>(
  input: I,
  options: TraderMainnetMutationOptions,
  context?: TraderContext
): Promise<TraderResult<TraderDataForInput<I>>>;
