# @maitask/trader

High-level trader orchestration for Maitask workflows. The package combines market analysis, risk evaluation, order execution, and paper trading so you can build self-contained automations without deploying the NOFX stack.

## Highlights

- **Multi-step pipeline** – fetches market data, computes SMA/EMA/RSI/volatility, derives trade signals, and exposes recommended targets.
- **Multi-market support** – plug into Binance (futures/spot), Aster, OKX, or the deterministic paper simulator; add more providers by dropping files into `providers/`.
- **Risk control** – configurable loss/drawdown guards, position sizing rules, leverage caps, and directional toggles.
- **Execution modes** – route live orders to Binance futures (mainnet/testnet) or use the deterministic paper simulator that tracks positions, equity, and fills.
- **Lifecycle coverage** – analyze-only flows, execute with optional manual overrides, cancel outstanding orders, pull account status, or backtest strategies on historical candles.
- **Streaming taps** – subscribe to provider WebSocket feeds (tickers, book updates, trades) with bounded windows for downstream automation.

## Directory Layout

```text
packages/trader/
├── package.json
├── README.md
├── example.json
├── index.js                # Orchestrator + risk/strategy logic
├── index.d.ts              # Types consumed by Maitask tooling/IDEs
├── providers/              # Exchange adapters (binance, aster, okx, paper)
└── shared/                 # Common helpers: constants, crypto/fetch wrappers, paper state
```

Adding a venue is as simple as dropping a file into `providers/` and registering it inside `providers/factory.js`.

## Inputs

| Field | Description |
|-------|-------------|
| `action` | `analyze` (default), `execute`, `status`, `cancel`, or `backtest`. |
| `symbol` | Trading pair, e.g., `BTCUSDT`. |
| `interval` | Kline interval (`5m`, `1h`, etc.). |
| `strategy` | Strategy config – choose `type` from `sma-crossover`, `rsi-mean-reversion`, `momentum-breakout`, or `manual`. |
| `decision` | Optional manual decision `{ signal, confidence, reason }` that skips indicator logic. |
| `quantity` / `quoteQuantity` | Absolute size (base) or notional amount in quote currency. If omitted, the package sizes positions using `positionRiskPct`. |
| `execution` | Order parameters: `{ type, timeInForce, reduceOnly, quantityPrecision, orderId/clientOrderId }`. |
| `risk` | `{ maxDailyLoss, maxDrawdown, positionRiskPct, stopLossPct, takeProfitPct, allowLong, allowShort }`. |
| `performance` | Live metrics (`dailyLoss`, `drawdown`, `equity`) used for guardrails. |
| `exchange` | `{ provider: 'binance' \\ 'aster' \\ 'okx' \\ 'paper', market?, apiKey, apiSecret, testnet?, passphrase? }`. Keys can also live in `context.secrets`. |
| `exchange.market` | Market flavor per provider (`'futures'`, `'spot'`, `'swap'`). Defaults to `'futures'` for Binance, `'swap'` for OKX, and is ignored for the paper simulator. |
| `stream` | Streaming preferences `{ channel, interval, limit, durationMs }` used by the `stream` action. |
| `paperState` | Persisted simulator state from the previous invocation (positions, balance, equity curve). |
| `backtest` | Optional `{ candles, capital }` override for the `backtest` action. |

## Supported Providers

- **`binance`** – native support for USDⓈ-M futures (`exchange.market: "futures"`, default) and spot (`exchange.market: "spot"`). Set `exchange.testnet: true` to target Binance testnets.
- **`aster`** – Binance-compatible perpetuals hosted at `https://fapi.asterdex.com`. Uses the same HMAC signing as Binance futures.
- **`okx`** – Connect to OKX swap (`exchange.market: "swap"`, default) or spot markets (`"spot"`). Requires `apiKey`, `apiSecret`, and `passphrase`.
- **`paper`** – Deterministic simulator backed by Binance public market data.

Each adapter lives under `packages/trader/providers`, so adding an exchange is as simple as creating a new provider file and registering it in `providers/factory.js`.

## Actions

### Analyze

Collects the latest market snapshot, computes indicators, and returns a structured decision. Useful before routing the result into other packages or custom logic.

```json
{
  "action": "analyze",
  "symbol": "ETHUSDT",
  "strategy": {
    "type": "sma-crossover",
    "fastLength": 12,
    "slowLength": 34
  }
}
```

### Execute (Futures)

Runs the analysis pipeline (unless a `decision` is provided), enforces risk limits, and routes an order. In `paper` mode the simulator updates and returns the latest `paperState`. For hosted exchanges (Binance, Aster, OKX) provide API credentials or mount them via secrets.

```json
{
  "action": "execute",
  "symbol": "BTCUSDT",
  "exchange": {
    "provider": "binance",
    "market": "futures",
    "testnet": true,
    "apiKey": "${BINANCE_API_KEY}",
    "apiSecret": "${BINANCE_API_SECRET}"
  },
  "risk": {
    "positionRiskPct": 0.015,
    "stopLossPct": 0.008,
    "takeProfitPct": 0.02
  }
}
```

### Execute (Spot)

```json
{
  "action": "execute",
  "symbol": "ETHUSDT",
  "exchange": {
    "provider": "binance",
    "market": "spot",
    "apiKey": "${BINANCE_SPOT_KEY}",
    "apiSecret": "${BINANCE_SPOT_SECRET}"
  },
  "quoteQuantity": 200,
  "strategy": { "type": "manual", "manualSignal": "long" }
}
```

### Execute (Aster)

```json
{
  "action": "execute",
  "symbol": "BTCUSDT",
  "exchange": {
    "provider": "aster",
    "apiKey": "${ASTER_API_KEY}",
    "apiSecret": "${ASTER_API_SECRET}"
  },
  "risk": {
    "positionRiskPct": 0.01,
    "stopLossPct": 0.007,
    "takeProfitPct": 0.02
  }
}
```

### Execute (OKX)

```json
{
  "action": "execute",
  "symbol": "BTCUSDT",
  "exchange": {
    "provider": "okx",
    "market": "swap",
    "apiKey": "${OKX_API_KEY}",
    "apiSecret": "${OKX_API_SECRET}",
    "passphrase": "${OKX_PASSPHRASE}"
  },
  "quantity": 0.01,
  "strategy": {
    "type": "momentum-breakout",
    "momentumLookback": 8
  }
}
```

### Stream (WebSocket)

Capture live ticks via provider WebSocket feeds. The task connects for a bounded window, collects messages, and returns the sampled payloads so downstream steps can react.

```json
{
  "action": "stream",
  "symbol": "BTCUSDT",
  "stream": {
    "channel": "bookTicker",
    "limit": 25,
    "durationMs": 8000
  },
  "exchange": {
    "provider": "binance",
    "market": "futures"
  }
}
```

For OKX streaming, set `exchange.provider: "okx"` and optionally change `stream.channel` to channels such as `"tickers"` or `"trades"`.

### Status

Fetches account balances, equity, and open positions. Works for both live Binance accounts and the paper simulator.

```json
{
  "action": "status",
  "symbol": "SOLUSDT",
  "exchange": { "provider": "paper" },
  "paperState": { ... }
}
```

### Cancel

Cancels an order by `execution.orderId` or `execution.clientOrderId`.

```json
{
  "action": "cancel",
  "symbol": "BTCUSDT",
  "execution": {
    "orderId": 123456789
  },
  "exchange": {
    "provider": "binance",
    "apiKey": "...",
    "apiSecret": "..."
  }
}
```

### Backtest

Runs a lightweight historical walkthrough using either on-demand candles (Binance public data) or user-provided OHLC arrays.

```json
{
  "action": "backtest",
  "symbol": "HYPEUSDT",
  "interval": "15m",
  "backtest": {
    "capital": 20000
  },
  "strategy": {
    "type": "rsi-mean-reversion",
    "lowerBand": 28,
    "upperBand": 72
  }
}
```

## Paper Trading Lifecycle

1. Run the package with `exchange.provider: "paper"` (no keys required).
2. Persist the returned `paperState` object.
3. Feed that state into the next invocation to continue the virtual portfolio.
4. Inspect `paperState.equityCurve` for performance telemetry or downstream visualization.

## Authentication Notes

- **Binance & Aster** – require API key + secret. Store them in Maitask secrets (`BINANCE_API_KEY`, `BINANCE_API_SECRET`, `ASTER_API_KEY`, …) or embed via the `exchange` object. Set `exchange.testnet: true` to access Binance testnets.
- **OKX** – requires `apiKey`, `apiSecret`, and `passphrase`. The package signs each call following OKX's spec.
- **Paper** – ignores credentials; persist the returned `paperState` to progress a rehearsal portfolio across steps.

## Example Payloads

See [`example.json`](./example.json) for a ready-to-run Binance futures configuration. Change `exchange.provider` / `exchange.market` (and credentials) to try Aster, OKX, or paper flows. For streaming payloads, reference [`example-stream.json`](./example-stream.json).

## Outputs

Each action returns `success: true`, a `timestamp`, and structured fields:

- `analysis` → `decision`, `indicators`, and raw market snapshot.
- `order` → routed order payload (real or simulated) with optional `targets`.
- `account` → balances, equity, and open positions.
- `paperState` → the updated simulator snapshot when applicable.
- `statistics` → backtest KPIs (trades, ROI, max drawdown).

Leverage the data with follow-up Maitask steps (notifications, logging, dashboards, etc.).
