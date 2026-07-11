# GitHub Integration Contract Design

## Goal

Replace the permissive GitHub wrapper with a formal GitHub REST client whose credentials, redirects, inputs, provider responses, and errors remain inside explicit production boundaries.

## Public contract

The package exposes nine camelCase actions: `listRepositories`, `getRepository`, `listIssues`, `createIssue`, `listPullRequests`, `getPullRequest`, `createPullRequest`, `getUser`, and `request`. Legacy kebab-case, dot-notation, snake_case fields, and parameter aliases are rejected.

`input` contains action-specific business data. `options` contains transport configuration: `baseUrl`, `token`, `timeoutMs`, `maxResponseBytes`, and `allowInsecureHttp`. Authentication may also use `context.secrets.GITHUB_TOKEN`. Input cannot override transport configuration or supply credentials.

## Credential confinement

`baseUrl` is normalized to one exact origin with no credentials, query, or fragment. HTTPS is mandatory except when `allowInsecureHttp` explicitly enables a literal private or local fixture host. Built-in endpoints and custom request paths are resolved relative to that origin; absolute and protocol-relative custom paths are rejected.

Every request uses `redirect: "manual"`. Redirects are followed only when the destination has the same origin as `baseUrl`, with a maximum of three hops. `Authorization` is written after caller headers and cannot be overridden. Caller headers cannot set authorization, cookies, proxy authorization, host, content length, transfer encoding, user agent, or GitHub API version.

## Data and error boundaries

Inputs, options, headers, query objects, JSON bodies, and context secret containers are copied from own data descriptors. Accessors, symbols, custom prototypes, cycles, behavioral objects, unknown fields, and non-JSON values are rejected before network access.

Responses are bounded before parsing. Built-in actions map known GitHub fields into controlled camelCase data. Custom request results contain a detached JSON value or bounded text, never a live provider object. Errors use stable codes and fixed messages; raw provider bodies, request URLs, tokens, cookies, arbitrary exceptions, and documentation URLs are not returned.

## Verification

Loopback fixtures cover public reads, authenticated writes, absolute-path rejection, same-origin redirects, cross-origin redirect refusal with zero target requests, protected headers, timeout, response limits, provider errors, secret accessors, and result mapping. A strict readonly TypeScript consumer verifies the public union. Live GitHub calls remain optional diagnostics.
