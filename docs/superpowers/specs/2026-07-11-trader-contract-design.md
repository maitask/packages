# Trader Contract Design

## Goal

Replace the ambiguous trading orchestrator with a deterministic package whose read-only analysis, historical simulation, paper execution, account inspection, cancellation, and real-money order placement are distinct operations with explicit authority and verifiable exchange behavior.

## Formal actions

The package exposes seven exact camelCase actions:

- `marketSnapshot`: read bounded public candles and ticker data.
- `analyze`: compute documented indicators and a recommendation without placing an order.
- `backtest`: run a deterministic local simulation over validated candles or a controlled public-history endpoint.
- `paperOrder`: apply one explicit order to caller-supplied paper state using deterministic fill rules.
- `accountSnapshot`: read a live account without mutating it.
- `cancelOrder`: cancel one explicitly identified live order.
- `placeOrder`: place one explicit live order.

Legacy `execute`, `status`, `cancel`, `stream`, implicit defaults, strategy-to-live-order conversion, and merged input/options aliases are removed. Managed Runtime has no formal WebSocket operation, so the legacy stream branch is removed instead of claiming an unavailable production capability.

## Exchange scope

Formal live and public adapters cover Binance spot, Binance USD-M futures, Aster perpetual futures, OKX spot, and OKX swap. Provider, market, and environment are explicit. Mainnet/testnet is never inferred for a mutating action. Provider API origins are trusted options and are validated as exact HTTPS origins; insecure HTTP is limited to explicit loopback/private fixtures.

Public Binance, Aster, and OKX market requests do not require credentials. Private operations resolve exact provider secret names from trusted options or `context.secrets`. Business input cannot contain API keys, secrets, passphrases, origins, timeouts, response limits, or live-trading policy.

## Live-trading authority

`placeOrder` and `cancelOrder` require trusted `options.allowLiveTrading: true`. Mainnet mutation additionally requires `options.allowMainnetTrading: true`. These flags are package operational policy and cannot be supplied by business input.

`placeOrder` accepts an explicit side, order type, size mode, price when required, time-in-force, reduce-only/position-side fields where supported, and optional client order identifier. It never derives an order from indicators, a recommendation, account equity, or default risk percentages. It sends each mutation once and never follows redirects or retries uncertain requests.

Before Binance/Aster placement, the adapter reads exchange symbol filters and normalizes quantity and price against exact step/tick sizes, minimum quantity, and minimum notional rules. Before OKX placement, it reads instruments and applies lot, tick, minimum size, contract-value, and market rules. Validation failures occur before the order POST. The package does not claim to configure leverage or place stop-loss/take-profit orders unless separate documented provider mutations are implemented.

## Analysis and backtesting

Candles use one formal `{ openTime, open, high, low, close, volume }` representation with finite positive prices, non-negative volume, strict chronological ordering, and bounded length. Provider arrays are mapped into this controlled type.

Analysis exposes SMA, EMA, RSI, close-to-close momentum, and population volatility with exact parameter validation. Strategy recommendations are limited to `smaCrossover`, `rsiMeanReversion`, `momentum`, and `manual`. Results are recommendations, not execution instructions, and include sufficient parameter metadata to reproduce them.

Backtesting uses explicit capital, fee basis points, slippage basis points, position fraction, long/short permission, and one-position-at-a-time rules. It marks equity on every candle, realizes PnL exactly once when positions close or reverse, closes the final position, and reports gross/net PnL, fees, return, trade count, wins/losses, win rate, maximum drawdown, and a controlled trade ledger. It does not use future candles to make earlier decisions.

## Paper execution

Paper state is caller-owned, versioned, bounded, and synchronously detached. A paper order is explicit and uses a caller-provided reference price or a controlled public snapshot. Market fills apply configured slippage; limit fills require the reference price to cross the limit. Fees, balances, realized PnL, open positions, orders, and equity history are updated with finite decimal arithmetic and stable identifiers. Paper receipts are always labelled `paper`; no simulated object is described as an exchange fill.

## Transport and error boundaries

All HTTP calls use manual redirect mode, one total operation deadline, bounded response bytes, strict UTF-8 JSON, and stable errors. Credentials are added after caller-independent header construction and are confined to the configured provider origin. Provider bodies, request URLs, credentials, signatures, account identifiers, raw exceptions, and arbitrary fields are never returned.

Input, options, context, credentials, candles, state, strategy, order, and provider responses are copied from own data descriptors. Accessors, symbols, custom prototypes, cycles, sparse arrays, unknown fields, aliases, non-finite values, and provider objects outside controlled mappings fail closed.

Errors use stable `TRADER_VALIDATION`, `TRADER_SECRET_UNAVAILABLE`, `TRADER_POLICY`, `TRADER_TIMEOUT`, `TRADER_RESPONSE_TOO_LARGE`, `TRADER_REDIRECT`, `TRADER_PROVIDER`, and `TRADER_UPSTREAM` codes.

## Packaging

The package publishes one reviewed CommonJS `index.js`, readonly declarations, README, and examples. The untracked-source/generated-bundle split is removed: `dist/index.cjs` and the obsolete ESM adapter tree are deleted after their verified behavior is incorporated. The published entry is the reviewed source and requires no hidden build step.

## Verification

Deterministic fixtures cover public data mapping, all analysis strategies, chronological candle rejection, long/short backtests, fee/slippage/drawdown accounting, resumable paper state, Binance/Aster/OKX signatures, symbol filters, exact live order wires, credential confinement, mainnet authority, one-attempt mutations, redirects with zero target requests, timeouts, response limits, stable failures, package archives, and readonly action-specific TypeScript contracts. Live exchange diagnostics are optional and never the sole release gate.
