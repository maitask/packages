# @maitask/github-integration

Credential-confined GitHub REST API client for repositories, issues, pull requests, users, and controlled custom API requests.

Version 1.0 defines one formal camelCase contract. Earlier kebab-case actions, dot-notation operations, snake_case fields, parameter aliases, absolute custom endpoints, and caller-managed authorization headers are not supported.

## Security model

- `input` contains action data only.
- `options` contains trusted transport configuration and an optional token.
- Tokens may also come from `context.secrets.GITHUB_TOKEN`.
- Every URL is resolved relative to one validated `baseUrl`.
- Custom request paths must be relative API paths beginning with `/`.
- Every HTTP redirect is handled manually; only same-origin `GET` and `HEAD` redirects are followed.
- Write requests are sent once and never redirected or retried.
- Authorization, cookies, host, content length, user agent, API version, and other managed headers cannot be supplied by the caller.
- Responses have a total deadline and a byte limit before JSON or text parsing.
- Public errors never contain tokens, cookies, request URLs, provider bodies, documentation URLs, or arbitrary exception messages.

## Actions

| Action | Required fields | Result item |
| --- | --- | --- |
| `listRepositories` | None, or `owner` | `GitHubRepository` |
| `getRepository` | `owner`, `repository` | `GitHubRepository` |
| `listIssues` | `owner`, `repository` | `GitHubIssue` |
| `createIssue` | `owner`, `repository`, `title`; token required | `GitHubIssue` |
| `listPullRequests` | `owner`, `repository` | `GitHubPullRequest` |
| `getPullRequest` | `owner`, `repository`, `pullNumber` | `GitHubPullRequest` |
| `createPullRequest` | `owner`, `repository`, `title`, `head`, `base`; token required | `GitHubPullRequest` |
| `getUser` | Optional `username`; token required when omitted | `GitHubUser` |
| `request` | `method`, relative `path` | JSON value or text |

Public repository and user reads can run without a token. Authenticated-account reads and every write require a token.

## Options

```ts
interface GitHubOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
}
```

| Option | Default | Contract |
| --- | --- | --- |
| `baseUrl` | `https://api.github.com` | GitHub API or GitHub Enterprise API base. Credentials, query strings, and fragments are rejected. |
| `token` | Context secret fallback | Token confined to the exact base origin. |
| `timeoutMs` | `30000` | Total deadline from 10 through 120000 milliseconds, including redirects and response reading. |
| `maxResponseBytes` | `4194304` | Maximum response size from 1 byte through 20 MiB. Runtime policy may impose a lower limit. |
| `allowInsecureHttp` | `false` | Permits HTTP only for literal loopback/private fixture hosts. Never permits public plaintext GitHub credentials. |

## Examples

### List public repositories

```js
const result = await execute({
  action: 'listRepositories',
  owner: 'octocat',
  ownerType: 'user',
  perPage: 20,
  page: 1,
  sort: 'updated',
  direction: 'desc'
});
```

### Create an issue with a Runtime secret

```js
const result = await execute(
  {
    action: 'createIssue',
    owner: 'acme',
    repository: 'service',
    title: 'Production incident follow-up',
    body: 'Track the remediation and verification work.',
    labels: ['operations']
  },
  {},
  {
    secrets: {
      GITHUB_TOKEN: 'provided-by-runtime-secret-storage'
    }
  }
);
```

### Controlled custom request

```js
const result = await execute(
  {
    action: 'request',
    method: 'GET',
    path: '/repos/acme/service/actions/runs',
    query: {
      per_page: 20,
      status: 'failure'
    },
    headers: {
      Accept: 'application/vnd.github+json'
    },
    responseType: 'json'
  },
  {
    timeoutMs: 20000,
    maxResponseBytes: 2097152
  }
);
```

`query` keys use GitHub wire names because they are sent directly to the REST API. Package fields and mapped results remain camelCase.

## Redirect and credential behavior

The package sends fetch with `redirect: "manual"`. `301`, `302`, `303`, `307`, and `308` are accepted only for `GET` or `HEAD`, only to the same origin as `baseUrl`, and only up to three hops. Cross-origin redirects are rejected before the target is contacted. Write redirects are rejected rather than changing or replaying the method.

Caller request headers may customize values such as `Accept` and tracing headers. They cannot set `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, `Content-Type`, `Content-Length`, `User-Agent`, `X-GitHub-Api-Version`, or hop-by-hop transport headers. The package writes its managed headers after caller validation.

## Result contract

Successful actions return platform-standard items and summary data:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "index": 0,
        "id": "42",
        "data": {
          "id": 42,
          "name": "demo",
          "fullName": "acme/demo"
        }
      }
    ],
    "summary": {
      "total": 1,
      "success_count": 1,
      "failure_count": 0
    }
  },
  "error": null,
  "metadata": {
    "package": "@maitask/github-integration",
    "version": "1.0.0",
    "provider": "github",
    "action": "listRepositories",
    "status": 200,
    "redirects": 0,
    "rateLimit": {
      "limit": 60,
      "remaining": 59,
      "reset": 1234567890,
      "used": 1,
      "resource": "core"
    }
  },
  "citations": []
}
```

Known GitHub objects are mapped to controlled camelCase fields. Unknown provider fields are ignored. Custom request JSON is parsed into detached JSON data; `responseType: "text"` returns bounded text.

## Error codes

| Code | Meaning |
| --- | --- |
| `GITHUB_VALIDATION` | Input, options, action fields, headers, or body do not match the formal contract. |
| `GITHUB_POLICY` | The configured base URL violates HTTPS/private-host policy. |
| `GITHUB_TIMEOUT` | The total request deadline expired. |
| `GITHUB_RESPONSE_TOO_LARGE` | The response exceeded `maxResponseBytes`. |
| `GITHUB_REDIRECT` | A redirect was cross-origin, malformed, missing, excessive, or attempted for a write. |
| `GITHUB_API` | GitHub returned a non-success HTTP status. |
| `GITHUB_UPSTREAM` | The network transport or successful response format failed. |

`GITHUB_API` includes only the numeric status, retry classification, and controlled rate-limit metadata. Provider error bodies and documentation URLs are never returned.

## Verification

Mandatory regression is deterministic and uses loopback fixtures:

```bash
npm run test:github-integration
npm run test:github-integration-types
```

Live GitHub and GitHub Enterprise requests are optional operational diagnostics, not mandatory release-gate dependencies.
