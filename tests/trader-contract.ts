import {
  execute,
  type TraderAnalyzeInput,
  type TraderBacktestInput,
  type TraderMainnetMutationOptions,
  type TraderPaperOrderInput,
  type TraderResult,
  type TraderTestnetMutationOptions
} from '../trader';

const candles = Array.from({ length: 60 }, (_, index) => ({
  openTime: 1_700_000_000_000 + index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 10 + index
}));

const analyzeInput = {
  action: 'analyze',
  symbol: 'BTCUSDT',
  interval: '1m',
  candles,
  strategy: { type: 'smaCrossover', fastLength: 5, slowLength: 20 }
} as const satisfies TraderAnalyzeInput;

const backtestInput = {
  action: 'backtest',
  symbol: 'BTCUSDT',
  interval: '1m',
  candles,
  strategy: { type: 'momentum', momentumLookback: 5 },
  simulation: { initialCapital: 10_000, feeBps: 5, slippageBps: 2, allowLong: true, allowShort: true }
} as const satisfies TraderBacktestInput;

const paperInput = {
  action: 'paperOrder',
  symbol: 'BTCUSDT',
  referencePrice: '100',
  eventTime: 1_700_000_000_000,
  order: { side: 'buy', type: 'market', quantity: '1' },
  simulation: { feeBps: 5, slippageBps: 2, allowLong: true, allowShort: true },
  paperState: {
    version: 1,
    quoteBalance: '1000',
    positions: [],
    orders: [],
    realizedPnl: '0',
    feesPaid: '0',
    equityHistory: []
  }
} as const satisfies TraderPaperOrderInput;

const testnetOptions = {
  allowLiveTrading: true,
  apiKeySecret: 'BINANCE_API_KEY',
  apiSecretSecret: 'BINANCE_API_SECRET',
  secrets: { BINANCE_API_KEY: 'configured-key', BINANCE_API_SECRET: 'configured-secret' }
} as const satisfies TraderTestnetMutationOptions;

const mainnetOptions = {
  allowLiveTrading: true,
  allowMainnetTrading: true,
  apiKeySecret: 'ASTER_API_KEY',
  apiSecretSecret: 'ASTER_API_SECRET',
  secrets: { ASTER_API_KEY: 'configured-key', ASTER_API_SECRET: 'configured-secret' }
} as const satisfies TraderMainnetMutationOptions;

const analysis = execute(analyzeInput);
execute(backtestInput);
execute(paperInput);
execute({
  action: 'marketSnapshot',
  symbol: 'BTCUSDT',
  interval: '1m',
  limit: 120,
  exchange: { provider: 'okx', market: 'swap', environment: 'testnet' }
});
execute({
  action: 'accountSnapshot',
  symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'futures', environment: 'mainnet' }
}, mainnetOptions);
execute({
  action: 'placeOrder',
  symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  order: { side: 'buy', type: 'market', quoteQuantity: '100', clientOrderId: 'order-1' }
}, testnetOptions);
execute({
  action: 'placeOrder',
  symbol: 'BTCUSDT',
  exchange: { provider: 'okx', market: 'swap', environment: 'testnet' },
  order: { side: 'buy', type: 'limit', quantity: '2', price: '100', timeInForce: 'GTC', positionSide: 'long' }
}, {
  ...testnetOptions,
  passphraseSecret: 'OKX_PASSPHRASE',
  secrets: { OKX_API_KEY: 'configured-key', OKX_API_SECRET: 'configured-secret', OKX_PASSPHRASE: 'passphrase' },
  apiKeySecret: 'OKX_API_KEY',
  apiSecretSecret: 'OKX_API_SECRET'
});
execute({
  action: 'placeOrder',
  symbol: 'BTCUSDT',
  exchange: { provider: 'aster', market: 'futures', environment: 'mainnet' },
  order: { side: 'sell', type: 'limit', quantity: '1', price: '100', timeInForce: 'GTC', reduceOnly: true }
}, mainnetOptions);
execute({
  action: 'cancelOrder',
  symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  order: { clientOrderId: 'order-1' }
}, testnetOptions);

const genericResult: Promise<TraderResult> = analysis;
void genericResult;

analysis.then(result => {
  if (result.success) {
    const signal: 'long' | 'short' | 'flat' = result.data.items[0].data.recommendation.signal;
    const authorized: false = result.data.items[0].data.recommendation.executionAuthorized;
    void [signal, authorized];

    // @ts-expect-error results are readonly
    result.data.items[0].data.recommendation.executionAuthorized = true;
  } else {
    const code: string = result.error.code;
    void code;
  }
});

// @ts-expect-error ambiguous execute action was removed
execute({ action: 'execute', symbol: 'BTCUSDT' }, testnetOptions);

// @ts-expect-error streaming is unavailable in the managed Runtime contract
execute({ action: 'stream', symbol: 'BTCUSDT' }, testnetOptions);

const credentialInput = {
  action: 'analyze', symbol: 'BTCUSDT', interval: '1m', candles,
  // @ts-expect-error credentials cannot be supplied by business input
  apiKey: 'literal-secret'
} as const satisfies TraderAnalyzeInput;
void credentialInput;

execute({
  action: 'marketSnapshot', symbol: 'BTCUSDT', interval: '1m',
  // @ts-expect-error Aster has no supported testnet origin
  exchange: { provider: 'aster', market: 'futures', environment: 'testnet' }
});

// @ts-expect-error testnet mutations require trusted live-trading authority
execute({
  action: 'cancelOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  order: { orderId: '1' }
}, {});

// @ts-expect-error mainnet mutations require explicit mainnet authority
execute({
  action: 'placeOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'futures', environment: 'mainnet' },
  order: { side: 'buy', type: 'market', quantity: '1' }
}, testnetOptions);

// @ts-expect-error spot orders cannot use reduce-only semantics
execute({
  action: 'placeOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  order: { side: 'sell', type: 'market', quantity: '1', reduceOnly: true }
}, testnetOptions);

// @ts-expect-error OKX spot does not accept quoteQuantity through this base-quantity contract
execute({
  action: 'placeOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'okx', market: 'spot', environment: 'testnet' },
  order: { side: 'buy', type: 'market', quoteQuantity: '100' }
}, testnetOptions);

execute({
  action: 'placeOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  // @ts-expect-error limit orders require explicit time in force
  order: { side: 'buy', type: 'limit', quantity: '1', price: '100' }
}, testnetOptions);

execute({
  action: 'cancelOrder', symbol: 'BTCUSDT',
  exchange: { provider: 'binance', market: 'spot', environment: 'testnet' },
  // @ts-expect-error cancellation identifiers are mutually exclusive
  order: { orderId: '1', clientOrderId: 'order-1' }
}, testnetOptions);
