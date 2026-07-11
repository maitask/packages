# Email Sender Contract Implementation Plan

**Goal:** Deliver a strict, credential-confined, attachment-capable, deterministic, typed SendGrid and Mailgun package with no fake SMTP or template behavior.

**Architecture:** Snapshot one formal message, render or map one content mode, encode provider-specific JSON or multipart bytes, execute exactly one bounded manual-redirect POST under one deadline, and map the provider response into a controlled receipt.

**Tech Stack:** Node.js 18+ fetch, Maitask Runtime `bodyBase64`, URL, AbortController, node:test loopback fixtures, TypeScript 5 strict declarations.

---

### Task 1: Add adversarial provider fixtures

**Files:**
- Create: `tests/email-sender-fixtures.test.js`
- Modify: `package.json`

- [ ] Cover the complete SendGrid JSON payload with `to`, `cc`, `bcc`, reply-to, direct text/HTML, headers, tags, metadata, and attachments.
- [ ] Cover Mailgun multipart payload paths, Basic authentication, repeated recipients/tags, metadata, text/HTML, and exact attachment bytes.
- [ ] Cover local template interpolation and HTML escaping plus provider-native template mapping for both providers.
- [ ] Assert missing secrets, literal credentials, aliases, unknown fields, accessors, symbols, custom prototypes, cycles, sparse arrays, invalid/duplicate recipients, header injection, and invalid attachments fail before contact.
- [ ] Cover Runtime Base64 request transport, manual redirect refusal with zero target requests, timeout, response limit, provider errors, arbitrary transport exceptions, and one-attempt delivery behavior.
- [ ] Add `test:email-sender` and confirm the intended failing baseline.

### Task 2: Implement the formal delivery contract

**Files:**
- Replace: `email-sender/index.js`
- Test: `tests/email-sender-fixtures.test.js`

- [ ] Replace input/options merging and aliases with own-data snapshots and exact field validation.
- [ ] Normalize recipients, addresses, content modes, safe local templates, provider templates, headers, tags, metadata, and bounded canonical attachments.
- [ ] Resolve credentials only from trusted secret containers and validate exact provider origins and Mailgun domain configuration.
- [ ] Build complete SendGrid JSON and exact Mailgun multipart requests without mutating caller data.
- [ ] Execute one manual-redirect POST under one total deadline and bounded response collection in Node and Runtime transports.
- [ ] Map controlled success receipts and stable secret-safe failures without provider bodies or arbitrary exception data.
- [ ] Remove SMTP, implicit content, unsupported Handlebars syntax, legacy snake_case names, and literal credential paths.

### Task 3: Publish types, metadata, and documentation

**Files:**
- Replace: `email-sender/index.d.ts`
- Replace: `email-sender/README.md`
- Modify: `email-sender/example.json`
- Modify: `email-sender/package.json`
- Modify: `PACKAGES.md`
- Create: `tests/email-sender-contract.ts`
- Modify: `package.json`

- [ ] Define readonly content, template, recipient, attachment, provider option, receipt, metadata, and discriminated result types with provider-specific overloads.
- [ ] Add strict positive and `@ts-expect-error` assertions for SMTP, aliases, literal credentials, conflicting content modes, invalid retry concepts, protected headers, and readonly results.
- [ ] Document provider scope, secret sources, every message field, template behavior, attachments, recipient privacy, one-attempt semantics, errors, Runtime binary transport, and migration breaks.
- [ ] Publish only the implementation, declarations, README, and example.

### Task 4: Complete Packages verification and integration

**Files:**
- No additional files unless a gate identifies a defect.

- [ ] Run syntax, focused fixtures, and strict TypeScript gates.
- [ ] Run metadata, archive, and `npm pack --dry-run --json ./email-sender` checks.
- [ ] Run `npm test` with zero failures, skips, or todos, then `git diff --check`.
- [ ] Commit the formal contract, fast-forward `packages/main`, verify the merged result, and remove the isolated worktree and branch.
