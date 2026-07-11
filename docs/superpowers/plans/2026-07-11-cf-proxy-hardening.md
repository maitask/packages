# CF Proxy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the permissive proxy transport with a production-grade, read-only, byte-safe proxy that validates every network hop and never forwards credentials across origins.

**Architecture:** `cf-proxy/index.js` will normalize immutable input into one formal camelCase contract, then execute requests through a single manual-redirect transport. Every target and Docker token realm is validated before access; response bytes and headers are normalized before entering a structured result. Deterministic loopback fixtures will cover success, denial, redirect, authentication, timeout, size, and binary paths.

**Tech Stack:** Node.js 18+ `fetch`, `AbortController`, `URL`, `Uint8Array`, `node:test`, loopback HTTP fixtures, Docker Registry v2 bearer challenges.

---

### Task 1: Add adversarial proxy transport regressions

**Files:**
- Create: `tests/cf-proxy-fixtures.test.js`
- Modify: `package.json`

- [x] Add loopback tests for binary response preservation, response-size enforcement, timeout, method validation, invalid URL forms, literal private hosts, and explicit `allowPrivateHosts` fixture access.
- [x] Add redirect tests for 301, 302, 303, 307, and 308. Assert each hop is revalidated, disallowed destinations receive zero requests, same-origin headers are retained, and cross-origin `Authorization`, `Cookie`, and proxy credentials are removed.
- [x] Add Docker challenge tests for approved and rejected token realms. Assert token requests receive no caller credentials and bearer tokens are sent only to the challenged registry origin.
- [x] Add error-result assertions proving target URLs, tokens, cookies, and provider bodies cannot enter returned messages.
- [x] Add `test:cf-proxy` to the root `package.json`, run it, and confirm the expected RED failures before implementation.

### Task 2: Implement one validated read-only transport

**Files:**
- Modify: `cf-proxy/index.js`
- Test: `tests/cf-proxy-fixtures.test.js`

- [x] Snapshot plain input/config/header data through own data descriptors; reject accessors, symbols, custom prototypes, legacy fields, and unsupported methods.
- [x] Normalize only absolute HTTP(S) URLs. Validate hostname allowlists, optional path prefixes, literal private/local addresses, credentials, query/fragment policy, and every redirect destination.
- [x] Execute `GET` and `HEAD` with `redirect: 'manual'`, a bounded timeout, and a maximum response byte limit. Apply standard redirect semantics without replaying write methods.
- [x] Strip hop-by-hop and managed headers. Preserve caller headers only for the original origin; remove authorization, cookies, and proxy credentials before any cross-origin hop.
- [x] Read response bytes without `text()` conversion, return one base64 payload with explicit encoding and byte length, and filter sensitive response headers.
- [x] Require the Runtime HTTP operation to return canonical Base64 bytes and a matching byte count instead of accepting lossy text-only responses.
- [x] Return stable camelCase success/error envelopes without raw URLs, secrets, provider objects, or arbitrary exception messages.

### Task 3: Constrain Docker bearer authentication

**Files:**
- Modify: `cf-proxy/index.js`
- Test: `tests/cf-proxy-fixtures.test.js`

- [x] Parse bearer challenges with order-independent parameters and reject malformed or non-Bearer challenges.
- [x] Validate token realm scheme, host allowlist, private-address policy, and redirect policy independently from registry content hosts.
- [x] Request tokens with a clean header set and the same timeout/size limits; accept only a bounded JSON object containing a non-empty string `token` or `access_token`.
- [x] Retry the original registry request once with the acquired bearer token; never forward it to redirects or expose it in output.

### Task 4: Publish the formal contract

**Files:**
- Modify: `cf-proxy/index.d.ts`
- Modify: `cf-proxy/README.md`
- Modify: `cf-proxy/example.json`

- [x] Replace generic declarations with explicit input, config, context, success, failure, metadata, and result types.
- [x] Document the read-only method contract, per-hop validation, private-host opt-in, allowed auth hosts, timeout/size bounds, manual redirects, base64 output, and secret-safe errors.
- [x] Remove AWS S3 signing and performance claims that are not implemented; do not describe placeholder compatibility behavior.
- [x] State that mandatory regression uses loopback fixtures and live registry/GitHub checks are optional diagnostics.

### Task 5: Complete the Packages gate

**Files:**
- No additional files unless verification exposes a defect.

- [x] Run `node --check cf-proxy/index.js` and strict `tsc` for `cf-proxy/index.d.ts`.
- [x] Run `npm run test:cf-proxy`, then `npm test` with zero skipped or todo tests.
- [x] Run `npm run test:metadata`, `npm run test:archives`, and `npm pack --dry-run --json ./cf-proxy`.
- [x] Run `git diff --check` and commit the completed formal transport contract.
