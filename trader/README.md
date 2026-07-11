# @maitask/trader

Production trading primitives for Maitask Runtime. The package keeps market reads, local analysis, historical simulation, paper execution, account inspection, cancellation, and real-money order placement as separate actions with explicit authority.

## Actions

| Action | Network | Credentials | Mutation |
| --- | --- | --- | --- |
| `marketSnapshot` | Public exchange API | No | No |
| `analyze` | None | No | No |
| `backtest` | None | No | No |
| `paperOrder` | None | No | Caller-owned paper state only |
| `accountSnapshot` | Private exchange API | Yes | No |
| `cancelOrder` | Private exchange API | Yes | Yes |
| `placeOrder` | Public metadata plus private exchange API | Yes | Yes |

The package does not expose the legacy `execute`, `status`, `cancel`, or `stream` actions. Recommendations never become orders automatically.

## Provider scope

| Provider | Market | Environment | Public data | Account | Place/cancel |
| --- | --- | --- | --- | --- | --- |
| Binance | Spot | Testnet, mainnet | Yes | Yes | Yes |
| Binance | USD-M futures | Testnet, mainnet | Yes | Yes | Yes |
| Aster | Perpetual futures | Mainnet only | Yes | Yes | Yes |
| OKX | Spot | Demo trading, mainnet | Yes | Yes | Yes |
| OKX | Swap | Demo trading, mainnet | Yes | Yes | Yes |

Aster does not have a verified public testnet origin in this contract. Supplying `environment: "testnet"` for Aster is rejected instead of routing a simulated label to mainnet.

Managed Runtime does not provide a formal WebSocket operation, so streaming is not claimed. The package also does not configure leverage or create stop-loss/take-profit orders; those require separate, explicit provider mutations before they can be represented as supported capabilities.

## Basic usage

```js
const { execute } = require('@maitask/trader');

const result = await execute({
  action: 'marketSnapshot',
  symbol: 'BTCUSDT',
  interval: '5m',
  limit: 120,
  exchange: {
    provider: 'binance',
    market: 'spot',
    environment: 'testnet'
  }
});
```

Every execution returns the standard Maitask result envelope. Provider bodies, URLs, signatures, credentials, passphrases, account identifiers, and raw exceptions are never returned.

## Local analysis

`analyze` requires controlled chronological candles:

```js
await execute({
  action: 'analyze',
  symbol: 'BTCUSDT',
  interval: '1m',
  candles,
  strategy: {
    type: 'smaCrossover',
    fastLength: 9,
    slowLength: 26,
    emaLength: 21,
    rsiLength: 14,
    volatilityLength: 20,
    momentumLookback: 5
  }
});
```

Formal strategies are `smaCrossover`, `rsiMeanReversion`, `momentum`, and `manual`. Results include SMA, EMA, RSI, population volatility, close-to-close momentum, exact parameters, and `executionAuthorized: false`.

Candles use this exact representation:

```ts
{
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

Prices must be finite and positive, volume must be non-negative, timestamps must be strictly increasing, and each high/low range must contain the open and close. Arrays are bounded and must contain enough history for every configured indicator.

## Backtesting

`backtest` uses only caller-supplied candles and never contacts an exchange:

```js
await execute({
  action: 'backtest',
  symbol: 'BTCUSDT',
  interval: '1m',
  candles,
  strategy: { type: 'momentum', momentumLookback: 5 },
  simulation: {
    initialCapital: 10000,
    positionFraction: 0.25,
    feeBps: 5,
    slippageBps: 2,
    allowLong: true,
    allowShort: true
  }
});
```

The engine is one-position-at-a-time and does not use future candles. Entry and exit fees are charged once, slippage is directional, reversals close the existing position first, and the final position is always closed. The result reports gross and net PnL, all fees, return, wins, losses, win rate, maximum drawdown, an equity curve, and a controlled trade ledger.

## Paper orders

Paper execution is deterministic and caller-owned. `eventTime` is required so identifiers, receipts, and equity history do not depend on the worker clock.

```js
const paper = await execute({
  action: 'paperOrder',
  symbol: 'BTCUSDT',
  referencePrice: '100.00',
  eventTime: 1700000000000,
  order: { side: 'sell', type: 'market', quantity: '2' },
  simulation: {
    feeBps: 5,
    slippageBps: 2,
    allowLong: true,
    allowShort: true
  },
  paperState: {
    version: 1,
    quoteBalance: '1000',
    positions: [],
    orders: [],
    realizedPnl: '0',
    feesPaid: '0',
    equityHistory: []
  }
});
```

Paper positions are unlevered collateral reservations. Each position records `side`, `quantity`, `entryPrice`, and `reservedNotional`; opening exposure cannot exceed available paper collateral. Opposite orders close, partially close, or reverse positions. `reduceOnly` prevents increases and reversals. Limit orders remain `open` unless the reference price crosses the limit. Every receipt is labelled `simulated: true` and `mode: "paper"`.

Persist `paperState` from one result and pass it into the next call. Input state is synchronously detached and is never mutated in place.

## Credentials and trusted options

Private actions resolve named secrets from `options.secrets` or `context.secrets`. Credentials are not accepted in business input.

```js
const options = {
  apiKeySecret: 'BINANCE_API_KEY',
  apiSecretSecret: 'BINANCE_API_SECRET',
  secrets: {
    BINANCE_API_KEY: configuredApiKey,
    BINANCE_API_SECRET: configuredApiSecret
  }
};
```

Default secret names are:

- Binance: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- Aster: `ASTER_API_KEY`, `ASTER_API_SECRET`
- OKX: `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_PASSPHRASE`

`baseUrl`, timeouts, response limits, secret names, secrets, and live-trading policy are trusted options. `baseUrl` must be an exact origin without credentials, path, query, or fragment. HTTPS is required outside explicitly enabled loopback or RFC 1918 fixture endpoints.

## Live authority

Testnet or OKX demo mutations require trusted live authority:

```js
await execute({
  action: 'placeOrder',
  symbol: 'BTCUSDT',
  exchange: {
    provider: 'binance',
    market: 'spot',
    environment: 'testnet'
  },
  order: {
    side: 'buy',
    type: 'limit',
    quantity: '0.01',
    price: '50000',
    timeInForce: 'GTC',
    clientOrderId: 'workflow-order-1'
  }
}, {
  ...options,
  allowLiveTrading: true
});
```

Mainnet placement or cancellation additionally requires `allowMainnetTrading: true`. `accountSnapshot` is read-only and does not require mutation authority, but it always requires private credentials.

Each exchange mutation is sent once. Redirects are rejected and uncertain writes are never replayed.

## Order contract

Quantities, quote quantities, prices, account values, and live receipts use decimal strings. Live normalization uses decimal strings and `BigInt`, not floating-point arithmetic.

- Market orders must provide exactly one size field.
- Binance spot market orders may use either `quantity` (base asset) or `quoteQuantity`.
- OKX spot uses `quantity` as base currency and sends `tgtCcy: "base_ccy"` for market orders.
- Binance futures, Aster futures, and OKX swap require `quantity`.
- Limit orders require `price` and explicit `timeInForce` (`GTC`, `IOC`, or `FOK`).
- Spot orders reject `reduceOnly` and `positionSide`.
- Derivative orders may use `positionSide` for hedge/long-short mode or `reduceOnly` for one-way/net mode, but never both.
- Cancellation accepts exactly one of `orderId` or `clientOrderId`.

Before Binance or Aster placement, the package loads exchange information and enforces symbol status, tick size, price range, lot/market-lot step, quantity range, quote-order permission, and minimum/maximum notional rules. A base-quantity market order also loads the current ticker when a notional rule must be checked.

Before OKX placement, the package loads the formal instrument and enforces live state, tick size, lot size, minimum size, market/limit maximum size, and contract value metadata. Swap quantity is the exchange contract count.

## Transport guarantees

- Maitask Runtime `op_http_request` is preferred when available.
- Fetch is the local Node.js fallback.
- All responses use strict UTF-8 JSON decoding.
- Redirect mode is always manual and every redirect is rejected.
- One total deadline covers metadata reads, signing, account reads, and mutation.
- Response bodies are streamed into a configured byte limit.
- Credentials are attached only after an exact same-origin request URL is constructed.
- No request is retried by this package.

## Stable errors

| Code | Meaning |
| --- | --- |
| `TRADER_VALIDATION` | Input or normalized order is invalid |
| `TRADER_SECRET_UNAVAILABLE` | Required named credentials are unavailable |
| `TRADER_POLICY` | Origin or live-trading policy denied the operation |
| `TRADER_TIMEOUT` | The total operation deadline expired |
| `TRADER_RESPONSE_TOO_LARGE` | A response exceeded the byte limit |
| `TRADER_REDIRECT` | An exchange attempted to redirect |
| `TRADER_PROVIDER` | The exchange rejected the request or instrument state |
| `TRADER_UPSTREAM` | Transport or provider data was malformed |

Errors are stable, controlled, and secret-safe. Raw provider messages are intentionally omitted.

## Migration from 0.1

- Replace `execute`, `status`, `cancel`, and `stream` with the seven formal actions.
- Replace kebab-case strategy names with `smaCrossover`, `rsiMeanReversion`, `momentum`, or `manual`.
- Move all credentials and endpoint controls out of input and into trusted options or context secrets.
- Replace `testnet: boolean` with explicit `exchange.environment`.
- Replace merged risk/execution objects with explicit `simulation`, `paperState`, and `order` contracts.
- Do not convert analysis recommendations into live orders. Construct a separate `placeOrder` request under explicit authority.
- Remove leverage, stop-loss, take-profit, precision, and WebSocket fields; they did not represent complete provider operations.
- Persist versioned paper state with position side and reserved notional fields.

See `index.d.ts` for readonly action-specific contracts.
