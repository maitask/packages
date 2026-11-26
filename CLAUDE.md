# Maitask Packages Rules

Read root `AGENTS.md` first; this file adds catalog-only rules for `@maitask/*` packages.

## Package & Security Standards

- Follow `CONTRACT.md` for entry point `execute(input, options, context)` and output envelopes (`success`, `data`, `error`, `metadata`, `citations`).
- Read network endpoints, credentials, and security flags (`allowPrivateHosts`, `allowInsecureHttp`) strictly from trusted `options` or `context`; reject or strip untrusted `input` overrides. Enforce HTTP/HTTPS schemes, disallow embedded URL credentials, set `redirect: 'manual'`, apply deadlines, stream-cap response and error bodies before parsing, and redact URLs and secrets in all errors.
- Guard every parser, aggregator, and mapper with `Object.create(null)`, `isSafeKey`, `Object.hasOwn`, bounded regex length/match counts, and recursion depth limits (`$ref`, XML, YAML).
- Keep `maitask.schemas.input` on all packages (`maitask.schemas.options` omitted only on optionless packages), never put `example.json` sample values into schema `"default"`, keep `.d.ts` synced with `package.json`, and preserve all `*/package.json` `version` strings unless intentionally bumping and publishing to Plane before the release gate.

## Quality Gates

```bash
npm test
npm run test:cf-proxy-types && npm run test:github-integration-types && npm run test:http-request-types && npm run test:email-sender-types && npm run test:trader-types
tsc --strict --noEmit --target ES2022 --module commonjs --moduleResolution node */index.d.ts
```

Use TypeScript 5.x on `PATH` (`*/index.d.ts` checks fail on TS 6 due to removed `moduleResolution=node10`). Verify tarball contents with `npm pack` when changing metadata or `files`.
