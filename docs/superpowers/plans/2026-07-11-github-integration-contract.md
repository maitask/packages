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

- [x] Add a public `listRepositories` fixture asserting the exact GET path, GitHub headers, camelCase repository mapping, rate-limit metadata, and no authorization header without a token.
- [x] Add an authenticated `createIssue` fixture asserting one POST, exact JSON body, context-secret fallback, and absence of the token from the result.
- [x] Add absolute, protocol-relative, backslash, and path-traversal custom path tests that assert zero requests and `GITHUB_VALIDATION`.
- [x] Add same-origin and cross-origin redirect tests. Assert same-origin authentication is retained and cross-origin targets receive zero requests.
- [x] Add protected-header, accessor, symbol, custom-prototype, unknown-field, timeout, response-size, HTTP error, and arbitrary fetch exception tests with secret-negative assertions.
- [x] Add a complete built-in action matrix for repository, issue, pull-request, and user operations.
- [x] Add `test:github-integration`; run it and confirm the expected RED failures.

### Task 2: Implement the formal runtime contract

**Files:**
- Modify: `github-integration/index.js`
- Test: `tests/github-integration-fixtures.test.js`

- [x] Replace merging and alias normalization with own-data snapshots for the formal input, options, context secrets, headers, query, and JSON body contracts.
- [x] Validate the exact API origin, relative custom paths, HTTPS/private fixture policy, methods, pagination, enums, identifiers, and action-specific required fields.
- [x] Build authorization after validated caller headers and reject all managed or credential-bearing header names.
- [x] Execute requests through one total deadline, streamed response-size enforcement, and manual same-origin redirects with no retries.
- [x] Parse bounded JSON or text, map built-in provider objects to controlled camelCase data, and return platform-standard `items` and `summary` fields.
- [x] Return stable `GITHUB_VALIDATION`, `GITHUB_POLICY`, `GITHUB_TIMEOUT`, `GITHUB_RESPONSE_TOO_LARGE`, `GITHUB_REDIRECT`, `GITHUB_API`, and `GITHUB_UPSTREAM` errors without untrusted details.

### Task 3: Publish types and documentation

**Files:**
- Modify: `github-integration/index.d.ts`
- Modify: `github-integration/README.md`
- Modify: `github-integration/example.json`
- Modify: `github-integration/package.json`
- Create: `tests/github-integration-contract.ts`

- [x] Define readonly action inputs, options, context secrets, mapped provider data, rate limits, summaries, metadata, and discriminated success/failure results.
- [x] Add strict positive and `@ts-expect-error` consumer assertions for legacy actions, snake_case fields, absolute paths, protected headers, read bodies, and readonly results.
- [x] Document origin confinement, same-origin redirects, transport limits, action contracts, stable errors, fixture policy, and the intentional removal of aliases.
- [x] Replace the example token literal with a context-secret-based authenticated action.

### Task 4: Complete Packages verification

**Files:**
- No additional files unless a gate identifies a defect.

- [x] Run syntax, focused runtime, and strict TypeScript gates.
- [x] Run `npm test` with zero failures, skipped tests, or todo tests.
- [x] Run metadata, archive, and `npm pack --dry-run --json ./github-integration` checks.
- [x] Run `git diff --check` and commit the formal GitHub integration contract with a formal English message.
