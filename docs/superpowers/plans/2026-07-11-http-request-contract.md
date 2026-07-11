# HTTP Request Contract Implementation Plan

**Goal:** Deliver a strict, credential-confined, byte-accurate, deterministic, typed HTTP request package with no legacy aliases or unsafe replay paths.

**Architecture:** Snapshot the formal request and trusted transport options, materialize one immutable request, execute it through a manual-redirect and safe-retry state machine under one deadline, collect bounded exact bytes, and return controlled platform-standard results.

**Tech Stack:** Node.js 18+ fetch, AbortController, URL, TextEncoder/TextDecoder, node:test loopback fixtures, TypeScript 5 strict declarations.

---

### Task 1: Add adversarial deterministic fixtures

**Files:**
- Create: `tests/http-request-fixtures.test.js`
- Modify: `package.json`

- [x] Cover query values, normalized headers, JSON, text, Base64, URL-encoded, and multipart request bodies.
- [x] Cover bearer, Basic, and API-key context/options secrets and assert that resolved values are not copied into controlled results.
- [x] Assert missing secrets, accessors, symbols, custom prototypes, cycles, unknown fields, aliases, duplicate headers, protected headers, and invalid URLs fail before network access.
- [x] Cover exact binary response fidelity, strict JSON parsing, accepted statuses, streamed response limits, and total response-body timeout.
- [x] Cover manual/error/follow redirects, same-origin credential retention, cross-origin credential/header removal, disallowed redirect hosts, write redirect rejection, and zero-contact refusal.
- [x] Cover safe-method status/network retries, `Retry-After`, deadline-bounded backoff, and one-attempt timeout behavior for every unsafe method.
- [x] Add `test:http-request` and confirm the expected failing baseline.

### Task 2: Implement the formal runtime contract

**Files:**
- Replace: `http-request/index.js`
- Test: `tests/http-request-fixtures.test.js`

- [x] Replace permissive merging and aliases with own-data snapshots and exact field validation.
- [x] Build validated query, headers, secret-backed authentication, and mutually exclusive serializable bodies.
- [x] Validate URL scheme, trusted HTTP exception, optional exact-host policy, and transport ceilings.
- [x] Implement one-deadline manual redirect transport with same-origin retention and cross-origin header/credential removal.
- [x] Implement retry eligibility before error classification so unsafe requests are never replayed.
- [x] Enforce response limits while streaming, preserve exact Base64 bytes, and parse JSON/text from controlled bytes.
- [x] Return stable platform results and secret-safe failures without raw exception, URL, body, or provider data.

### Task 3: Publish types, metadata, and documentation

**Files:**
- Create: `http-request/index.d.ts`
- Replace: `http-request/README.md`
- Modify: `http-request/example.json`
- Modify: `http-request/package.json`
- Modify: `PACKAGES.md`
- Create: `tests/http-request-contract.ts`
- Modify: `package.json`

- [x] Define readonly input, option, authentication, body, redirect, retry, response, metadata, and discriminated result types.
- [x] Add strict positive and `@ts-expect-error` consumer assertions for aliases, literal credentials, protected headers, read bodies, conflicting bodies, unsafe retry configuration, and readonly results.
- [x] Document every request form, trusted option, secret source, redirect and retry rule, exact response representation, error code, Runtime interaction, and migration break.
- [x] Publish only the implementation, declarations, README, and example in the package archive.

### Task 4: Complete Packages verification and integration

**Files:**
- No additional files unless a gate identifies a defect.

- [x] Run syntax, focused runtime, and strict TypeScript gates.
- [x] Run metadata, archive, and `npm pack --dry-run --json ./http-request` checks.
- [x] Run `npm test` with zero failures, skips, or todos, then `git diff --check`.
- [x] Commit the formal contract, fast-forward `packages/main`, verify the merged result, and remove the isolated worktree and branch.
