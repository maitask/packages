# Trader Contract Implementation Plan

**Goal:** Deliver a strict trading package that makes analysis, simulation, paper state, and real-money mutations operationally distinct and fully testable.

**Architecture:** Snapshot an action-specific request, select one controlled provider adapter, execute bounded read or one-attempt mutation transport, map provider data into formal models, and keep all simulation math local and deterministic.

**Tech Stack:** CommonJS JavaScript, Web Crypto HMAC, Maitask Runtime HTTP operation, Node.js loopback fixtures, node:test, TypeScript 5 strict declarations.

---

### Task 1: Add deterministic market and trading fixtures

**Files:**
- Create: `tests/trader-fixtures.test.js`
- Modify: `package.json`

- [ ] Cover Binance spot/futures, Aster futures, and OKX spot/swap public snapshot mapping without credentials.
- [ ] Cover every analysis strategy and exact indicator parameters over fixed candles.
- [ ] Cover deterministic long/short backtests, fees, slippage, final closure, drawdown, and chronological validation.
- [ ] Cover resumable paper market/limit orders, fees, realized PnL, state detachment, and stable paper labelling.
- [ ] Cover provider signature strings, filter normalization, exact order/cancel/account wires, and controlled response mapping.
- [ ] Assert live/mainnet authority, secret confinement, aliases, unknown fields, accessors, symbols, custom prototypes, cycles, sparse arrays, invalid decimals, and malformed provider responses fail closed.
- [ ] Cover redirect zero-contact, timeout, response limits, one-attempt mutations, Runtime transport, and secret-safe errors.

### Task 2: Replace the package and adapter architecture

**Files:**
- Replace: `trader/index.js`
- Delete: `trader/dist/index.cjs`
- Delete: `trader/providers/*`
- Delete: `trader/shared/*`
- Modify: `trader/package.json`
- Test: `tests/trader-fixtures.test.js`

- [ ] Implement strict action, option, context, candle, strategy, paper state, and explicit order snapshots.
- [ ] Implement bounded public/private transport with manual redirects, one deadline, exact origin policy, and stable failures.
- [ ] Implement Binance/Aster HMAC SHA-256 and OKX HMAC Base64 signing without Node-only modules.
- [ ] Implement exchange metadata/filter loading and decimal-safe order normalization before live placement.
- [ ] Implement controlled provider mappings for market, account, order, and cancellation responses.
- [ ] Implement reproducible indicators, recommendations, backtests, and versioned paper accounting.
- [ ] Remove ambiguous execute/status/cancel/stream aliases, credential-bearing input, default live environments, generated bundle drift, and unimplemented leverage/stop claims.

### Task 3: Publish types and formal documentation

**Files:**
- Replace: `trader/index.d.ts`
- Replace: `trader/README.md`
- Replace: `trader/example.json`
- Delete: `trader/example-stream.json`
- Modify: `PACKAGES.md`
- Create: `tests/trader-contract.ts`

- [ ] Define readonly action-specific inputs, trusted provider options, controlled outputs, paper state, provider receipts, and discriminated failures.
- [ ] Add strict positive and `@ts-expect-error` assertions for ambiguous execute, stream, input credentials, missing live authority, implicit environments, and readonly results.
- [ ] Document provider/action scope, authority gates, filter handling, one-attempt mutations, simulation assumptions, errors, migration breaks, and optional live diagnostics.
- [ ] Publish only reviewed source, declarations, README, and the non-mutating example.

### Task 4: Complete verification and integration

**Files:**
- No additional files unless a gate identifies a defect.

- [ ] Run focused runtime and strict TypeScript gates.
- [ ] Run metadata, archive, and `npm pack --dry-run --json ./trader` checks.
- [ ] Run `npm test` with zero failures, skips, or todos and `git diff --check`.
- [ ] Commit, fast-forward `packages/main`, verify the merged result, and remove the isolated worktree and branch.
