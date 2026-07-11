# @maitask/cf-proxy

Validated read-only HTTP transport for retrieving GitHub resources and container registry content from Maitask workflows.

The package accepts only absolute HTTP or HTTPS URLs, only sends `GET` or `HEAD`, validates every redirect target, preserves response bytes as Base64, and confines Docker bearer credentials to the approved registry origin. It does not implement a general forward proxy, write methods, AWS request signing, or transparent credential forwarding.

## Capabilities

- Exact content-host and authentication-host allowlists.
- Optional path-prefix restrictions.
- Explicit opt-in for literal private and local hosts.
- Manual handling of HTTP `301`, `302`, `303`, `307`, and `308` responses.
- Cross-origin removal of `Authorization`, `Cookie`, and `Proxy-Authorization`.
- Docker Registry v2 bearer challenge support with a separate token-service allowlist.
- One total request deadline covering the initial request, authentication, and redirects.
- Per-response byte limits with early `Content-Length` rejection and streamed enforcement.
- Byte-safe Base64 results without UTF-8 conversion.
- Stable error codes that do not contain target URLs, credentials, provider bodies, or arbitrary exception messages.

## Input

```ts
interface CfProxyInput {
  readonly url: string;
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Readonly<Record<string, string>>;
  readonly config?: CfProxyConfig;
}
```

The input and configuration must be plain own-data objects. Accessors, symbol properties, custom prototypes, unknown fields, legacy snake_case fields, and non-string header values are rejected. Request header names must follow the HTTP token grammar, header values cannot contain CR or LF characters, and callers cannot set managed transport headers such as `Host`, `Content-Length`, or `Transfer-Encoding`.

### Configuration

| Field | Default | Contract |
| --- | --- | --- |
| `allowedHosts` | Official GitHub and registry hosts | Exact hostnames permitted for content requests and content redirects. Ports are defined by the request URL, not allowlist entries. |
| `allowedAuthHosts` | Known registry authentication hosts | Exact hostnames permitted for Docker token realms and their redirects. |
| `dockerRegistryHosts` | Default registry hosts that also appear in `allowedHosts` | Hosts for which a `401` response is processed as a Docker bearer challenge. An explicit list must be a subset of `allowedHosts`. |
| `restrictPaths` | `false` | Enables path-prefix enforcement for content URLs and every content redirect. |
| `allowedPaths` | `['/library']` | Exact path prefixes used when `restrictPaths` is enabled. |
| `maxRedirects` | `5` | Integer from `0` through `10`. |
| `timeoutMs` | `30000` | Total request deadline from `10` through `120000` milliseconds. |
| `maxResponseBytes` | `8388608` | Maximum bytes for each response, from `1` through `52428800`. Token responses are additionally capped at 64 KiB. |
| `allowPrivateHosts` | `false` | Allows literal loopback, private, link-local, `.local`, and localhost targets. Intended for controlled fixtures and private infrastructure only. |

URL credentials and fragments are rejected. Query strings are allowed because GitHub downloads and registry token services use them, but URLs are never returned in failure results.

## Docker bearer authentication

When the target hostname appears in `dockerRegistryHosts` and the registry returns `401`:

1. The package parses an order-independent `Bearer` challenge.
2. The challenge realm is validated against `allowedAuthHosts` and the private-host policy.
3. The token request is sent with only `Accept: application/json`; caller authorization, cookies, and custom headers are not forwarded.
4. A bounded JSON object containing a non-empty `token` or `access_token` string is required.
5. The original registry request is retried once with the acquired bearer token.
6. The token is removed before any cross-origin content redirect.

Malformed challenges, rejected realms, invalid token responses, and a second `401` return `CF_PROXY_AUTH`.

## Result

Successful transport returns the upstream HTTP status and byte-safe content. A received non-2xx HTTP response is still a successful transport result; inspect `data.ok` and `data.status` for upstream application status.

```json
{
  "success": true,
  "data": {
    "status": 200,
    "statusText": "OK",
    "ok": true,
    "headers": {
      "content-type": "application/vnd.oci.image.manifest.v1+json"
    },
    "bodyBase64": "eyJzY2hlbWFWZXJzaW9uIjoyfQ==",
    "bodyEncoding": "base64",
    "bodyBytes": 19,
    "isDockerRequest": true
  },
  "metadata": {
    "package": "@maitask/cf-proxy",
    "version": "0.1.0",
    "redirects": 0,
    "registryAuthenticated": true,
    "timestamp": "2026-07-11T00:00:00.000Z"
  }
}
```

Sensitive and hop-by-hop response headers, including `Set-Cookie`, `WWW-Authenticate`, `Location`, `Connection`, and `Transfer-Encoding`, are removed from the result.

### Error codes

| Code | Meaning |
| --- | --- |
| `CF_PROXY_VALIDATION` | The input does not match the formal contract. |
| `CF_PROXY_DENIED` | The content host, path, or private-host policy denied the request. |
| `CF_PROXY_TIMEOUT` | The total request deadline expired. |
| `CF_PROXY_RESPONSE_TOO_LARGE` | A response exceeded `maxResponseBytes`. |
| `CF_PROXY_REDIRECT` | A content redirect was missing, invalid, disallowed, or exceeded the configured limit. |
| `CF_PROXY_AUTH` | Docker bearer challenge or token acquisition failed. |
| `CF_PROXY_UPSTREAM` | The network transport or Runtime HTTP operation failed. |

Errors contain only a stable message, code, and type. They do not include provider response bodies, exception messages, target URLs, authorization values, cookies, or bearer tokens.

## Runtime transport requirement

In Maitask Runtime, the HTTP operation must return `status`, plain string headers, canonical `bodyBase64`, and matching `bodyBytes`. Text-only Runtime HTTP responses are rejected because converting arbitrary response bytes through UTF-8 would corrupt registry layers and binary GitHub artifacts.

## Example

```js
const { execute } = require('@maitask/cf-proxy');

const result = await execute({
  url: 'https://registry-1.docker.io/v2/library/ubuntu/manifests/latest',
  method: 'GET',
  headers: {
    Accept: 'application/vnd.oci.image.manifest.v1+json'
  },
  config: {
    restrictPaths: true,
    allowedPaths: ['/v2/library'],
    maxRedirects: 4,
    timeoutMs: 30000,
    maxResponseBytes: 8388608
  }
});

if (!result.success) {
  throw new Error(result.error.code);
}

const bytes = Buffer.from(result.data.bodyBase64, 'base64');
```

## Verification

Mandatory regression uses local loopback fixtures and does not depend on GitHub, Docker Hub, or another third party:

```bash
npm run test:cf-proxy
npm run test:cf-proxy-types
```

Live third-party requests are optional operational diagnostics, not the release gate for successful package behavior.
