# HTTP Request Contract Implementation Plan

**Goal:** Deliver a strict, credential-confined, byte-accurate, deterministic, typed HTTP request package with no legacy aliases or unsafe replay paths.

**Architecture:** Snapshot the formal request and trusted transport options, materialize one immutable request, execute it through a manual-redirect and safe-retry state machine under one deadline, collect bounded exact bytes, and return controlled platform-standard results.

**Tech Stack:** Node.js 18+ fetch, AbortController, URL, TextEncoder/TextDecoder, node:test loopback fixtures, TypeScript 5 strict declarations.

---

### Task 1: Add adversarial deterministic fixtures

**Files:**
- Create: `tests/http-request-fixtures.test.js`
- Modify: `package.json`

- [ ] Cover query values, normalized headers, JSON, text, Base64, URL-encoded, and multipart request bodies.
- [ ] Cover bearer, Basic, and API-key context/options secrets and assert that resolved values never appear in results.
- [ ] Assert missing secrets, accessors, symbols, custom prototypes, cycles, unknown fields, aliases, duplicate headers, protected headers, and invalid URLs fail before network access.
- [ ] Cover exact binary response fidelity, strict JSON parsing, accepted statuses, streamed response limits, and total response-body timeout.
- [ ] Cover manual/error/follow redirects, same-origin credential retention, cross-origin credential/header removal, downgrade refusal, disallowed redirect hosts, and zero-contact rejection.
- [ ] Cover safe-method status/network retries, `Retry-After`, deadline-bounded backoff, and one-attempt timeout behavior for every unsafe method.
- [ ] Add `test:http-request` and confirm the expected failing baseline.

### Task 2: Implement the formal runtime contract

**Files:**
- Replace: `http-request/index.js`
- Test: `tests/http-request-fixtures.test.js`

- [ ] Replace permissive merging and aliases with own-data snapshots and exact field validation.
- [ ] Build validated query, headers, secret-backed authentication, and mutually exclusive serializable bodies.
- [ ] Validate URL scheme, trusted HTTP exception, optional exact-host policy, and transport ceilings.
- [ ] Implement one-deadline manual redirect transport with same-origin retention and cross-origin header/credential removal.
- [ ] Implement retry eligibility before error classification so unsafe requests are never replayed.
- [ ] Enforce response limits while streaming, preserve exact Base64 bytes, and parse JSON/text from controlled bytes.
- [ ] Return stable platform results and secret-safe failures without raw exception, URL, body, or provider data.

### Task 3: Publish types, metadata, and documentation

**Files:**
- Create: `http-request/index.d.ts`
- Replace: `http-request/README.md`
- Modify: `http-request/example.json`
- Modify: `http-request/package.json`
- Modify: `PACKAGES.md`
- Create: `tests/http-request-contract.ts`
- Modify: `package.json`

- [ ] Define readonly input, option, authentication, body, redirect, retry, response, metadata, and discriminated result types.
- [ ] Add strict positive and `@ts-expect-error` consumer assertions for aliases, literal credentials, protected headers, read bodies, conflicting bodies, unsafe retry configuration, and readonly results.
- [ ] Document every request form, trusted option, secret source, redirect and retry rule, exact response representation, error code, Runtime interaction, and migration break.
- [ ] Publish only the implementation, declarations, README, and example in the package archive.

### Task 4: Complete Packages verification and integration

**Files:**
- No additional files unless a gate identifies a defect.

- [ ] Run syntax, focused runtime, and strict TypeScript gates.
- [ ] Run metadata, archive, and `npm pack --dry-run --json ./http-request` checks.
- [ ] Run `npm test` with zero failures, skips, or todos, then `git diff --check`.
- [ ] Commit the formal contract, fast-forward `packages/main`, verify the merged result, and remove the isolated worktree and branch.
