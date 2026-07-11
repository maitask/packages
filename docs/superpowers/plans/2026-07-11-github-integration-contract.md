# GitHub Integration Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a credential-confined, deterministic, typed GitHub REST package with no legacy aliases or untrusted provider data paths.

**Architecture:** Snapshot the formal action union and transport options, build all URLs relative to one validated API origin, execute one bounded manual-redirect transport, and map provider JSON into controlled result types.

**Tech Stack:** Node.js 18+ fetch, AbortController, URL, node:test loopback fixtures, TypeScript 5 strict declarations.

---

### Task 1: Add adversarial provider fixtures

**Files:**
- Create: `tests/github-integration-fixtures.test.js`
- Modify: `package.json`

- [ ] Add a public `listRepositories` fixture asserting the exact GET path, GitHub headers, camelCase repository mapping, rate-limit metadata, and no authorization header without a token.
- [ ] Add an authenticated `createIssue` fixture asserting one POST, exact JSON body, context-secret fallback, and absence of the token from the result.
- [ ] Add absolute and protocol-relative custom path tests that assert zero requests and `GITHUB_VALIDATION`.
- [ ] Add same-origin and cross-origin redirect tests. Assert same-origin authentication is retained, cross-origin targets receive zero requests, and all redirect status codes are bounded.
- [ ] Add protected-header, accessor, symbol, custom-prototype, unknown-field, timeout, response-size, malformed JSON, HTTP error, and arbitrary fetch exception tests with secret-negative assertions.
- [ ] Add `test:github-integration`; run it and confirm the expected RED failures.

### Task 2: Implement the formal runtime contract

**Files:**
- Modify: `github-integration/index.js`
- Test: `tests/github-integration-fixtures.test.js`

- [ ] Replace merging and alias normalization with own-data snapshots for the formal input, options, context secrets, headers, query, and JSON body contracts.
- [ ] Validate the exact API origin, relative custom paths, HTTPS/private fixture policy, methods, pagination, enums, identifiers, and action-specific required fields.
- [ ] Build authorization after validated caller headers and reject all managed or credential-bearing header names.
- [ ] Execute requests through one total deadline, streamed response-size enforcement, and manual same-origin redirects with no retries.
- [ ] Parse bounded JSON or text, map built-in provider objects to controlled camelCase data, and return platform-standard `items` and `summary` fields.
- [ ] Return stable `GITHUB_VALIDATION`, `GITHUB_POLICY`, `GITHUB_TIMEOUT`, `GITHUB_RESPONSE_TOO_LARGE`, `GITHUB_REDIRECT`, `GITHUB_API`, and `GITHUB_UPSTREAM` errors without untrusted details.

### Task 3: Publish types and documentation

**Files:**
- Modify: `github-integration/index.d.ts`
- Modify: `github-integration/README.md`
- Modify: `github-integration/example.json`
- Modify: `github-integration/package.json`
- Create: `tests/github-integration-contract.ts`

- [ ] Define readonly action inputs, options, context secrets, mapped provider data, rate limits, summaries, metadata, and discriminated success/failure results.
- [ ] Add strict positive and `@ts-expect-error` consumer assertions for legacy actions, snake_case fields, absolute paths, protected headers, and readonly results.
- [ ] Document origin confinement, same-origin redirects, transport limits, action contracts, stable errors, fixture policy, and the intentional removal of aliases.
- [ ] Replace the example token literal with a context-secret-based authenticated action.

### Task 4: Complete Packages verification

**Files:**
- No additional files unless a gate identifies a defect.

- [ ] Run syntax, focused runtime, and strict TypeScript gates.
- [ ] Run `npm test` with zero failures, skipped tests, or todo tests.
- [ ] Run metadata, archive, and `npm pack --dry-run --json ./github-integration` checks.
- [ ] Run `git diff --check`, commit with formal English messages, fast-forward merge to Packages `main`, and remove the worktree and branch.
