# @maitask/http-request

Strict general-purpose HTTP client for Maitask Runtime. Version 2 validates all request data before contact, resolves authentication only from trusted secret containers, handles redirects manually, retries only safe methods, applies one total deadline, bounds response bytes, and preserves every successful response as canonical Base64.

## Guarantees

- One strict camelCase input contract with no aliases or input/options merging.
- HTTPS by default. Trusted options may enable HTTP only for literal private or loopback fixtures.
- Optional exact-host policy for the initial request and every redirect target.
- Bearer, Basic, and API-key authentication from named `options.secrets` or `context.secrets` values.
- JSON, UTF-8 text, exact Base64, URL-encoded, and multipart request bodies.
- Manual redirect processing with a bounded hop count and no write-method redirects.
- Cross-origin redirects discard authentication and every caller header except `Accept` and `Accept-Language`.
- Automatic retry only for `GET`, `HEAD`, and `OPTIONS`; write methods are never replayed.
- One total deadline covering fetch, redirect handling, response reading, retry backoff, and `Retry-After` delays.
- Streamed response-size enforcement and exact `bodyBase64` plus `bodyBytes` output.
- Strict UTF-8 JSON/text parsing. JSON never silently falls back to text.
- Stable failures that do not contain request URLs, credentials, request or response bodies, raw exceptions, or provider messages.

Runtime network policy, `allowed_hosts`, HTTP timeout, and maximum response bytes remain additional ceilings. Package options and input values can only tighten those Runtime limits.

## Basic request

```js
const { execute } = require('@maitask/http-request');

const result = await execute({
  url: 'https://api.example.com/v1/resources',
  method: 'GET',
  query: {
    page: 1,
    include: ['owner', 'labels']
  },
  headers: {
    Accept: 'application/json',
    'X-Trace-Id': 'trace-1'
  },
  responseType: 'json'
}, {
  timeoutMs: 30000,
  maxResponseBytes: 8388608,
  maxRedirects: 5,
  allowedHosts: ['api.example.com']
});
```

## Authentication

Authentication input contains secret names, never literal credential values. `options.secrets` takes precedence over `context.secrets` for an exact name.

### Bearer

```js
await execute({
  url: 'https://api.example.com/v1/profile',
  auth: {
    type: 'bearer',
    tokenSecret: 'API_TOKEN'
  }
}, {}, {
  secrets: { API_TOKEN: 'runtime-managed-secret' }
});
```

### Basic

```js
await execute({
  url: 'https://api.example.com/v1/profile',
  auth: {
    type: 'basic',
    usernameSecret: 'API_USERNAME',
    passwordSecret: 'API_PASSWORD'
  }
}, {}, {
  secrets: {
    API_USERNAME: 'runtime-managed-username',
    API_PASSWORD: 'runtime-managed-password'
  }
});
```

Basic credentials are encoded from UTF-8 bytes.

### API key

```js
await execute({
  url: 'https://api.example.com/v1/profile',
  auth: {
    type: 'apiKey',
    header: 'X-API-Key',
    valueSecret: 'API_KEY'
  }
}, {
  secrets: { API_KEY: 'package-configured-secret' }
});
```

Missing, empty, inherited, accessor-backed, non-string, or malformed secret values are rejected before network contact. Caller headers cannot set the managed API-key header. Resolved values are never copied into package metadata or failures. Successful response bytes remain exact, so a service that deliberately echoes credentials can include them in its own accepted response.

## Request bodies

Only one request body field may be present. `GET` and `HEAD` cannot carry a body.

### JSON

```js
await execute({
  url: 'https://api.example.com/v1/resources',
  method: 'POST',
  json: {
    name: 'Production resource',
    enabled: true,
    labels: ['runtime', 'packages']
  },
  responseType: 'json',
  retry: { maxAttempts: 1 }
});
```

JSON values must be finite, acyclic JSON data with standard or null prototypes and own data properties.

### UTF-8 text

```js
await execute({
  url: 'https://api.example.com/v1/text',
  method: 'PUT',
  text: 'Maitask production payload 🚀',
  responseType: 'text',
  retry: { maxAttempts: 1 }
});
```

### Exact binary bytes

```js
await execute({
  url: 'https://api.example.com/v1/artifacts',
  method: 'PUT',
  bodyBase64: 'AP9B',
  responseType: 'base64',
  retry: { maxAttempts: 1 }
});
```

`bodyBase64` must be canonical RFC 4648 Base64. The default content type is `application/octet-stream`; supply a validated `Content-Type` header when another media type is required.

### URL-encoded form

```js
await execute({
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  form: {
    grant_type: 'client_credentials',
    scope: ['read', 'write']
  },
  responseType: 'json',
  retry: { maxAttempts: 1 }
});
```

Array values are emitted as repeated fields in declaration order.

### Multipart form

```js
await execute({
  url: 'https://api.example.com/v1/uploads',
  method: 'POST',
  multipart: {
    name: 'release-artifact',
    labels: ['production', 'signed'],
    artifact: {
      filename: 'artifact.bin',
      contentType: 'application/octet-stream',
      bodyBase64: 'AP9B'
    }
  },
  responseType: 'json',
  retry: { maxAttempts: 1 }
});
```

Multipart boundaries are generated by the package and verified against file bytes. Do not supply a multipart `Content-Type` header; the package writes the required boundary parameter.

## Input fields

| Field | Contract |
| --- | --- |
| `url` | Required absolute HTTP or HTTPS URL without embedded credentials or a fragment. |
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, or `OPTIONS`; default `GET`. |
| `query` | Record of string, finite number, boolean, or arrays of those values. Arrays become repeated parameters. |
| `headers` | String header record. Duplicate case variants, control characters, credentials, hop-by-hop headers, host, content length, user agent, and `Sec-*` headers are rejected. |
| `auth` | Secret-backed bearer, Basic, or API-key authentication. |
| `json` | JSON request body. |
| `text` | UTF-8 text request body. |
| `bodyBase64` | Exact binary request body as canonical Base64. |
| `form` | URL-encoded scalar or repeated scalar fields. |
| `multipart` | Scalar or repeated scalar fields and Base64 file parts. |
| `responseType` | `json`, `text`, or `base64`; default `json`. |
| `acceptedStatuses` | Explicit non-empty list of accepted HTTP statuses. Mutually exclusive with `acceptedStatusRange`. |
| `acceptedStatusRange` | Inclusive `{ min, max }` status range. Default status policy is `200` through `299`. |
| `redirect` | `follow`, `manual`, or `error`; default `follow`. |
| `timeoutMs` | Per-request total deadline that may tighten the trusted option ceiling. |
| `maxResponseBytes` | Per-request response ceiling that may tighten the trusted option ceiling. |
| `maxRedirects` | Per-request redirect limit that may tighten the trusted option ceiling. |
| `retry` | Safe-method retry policy. Write methods accept only `maxAttempts: 1`. |

## Trusted options

| Option | Default | Contract |
| --- | ---: | --- |
| `timeoutMs` | `30000` | Total deadline from 10 through 120000 milliseconds. |
| `maxResponseBytes` | `8388608` | Response limit from 1 byte through 50 MiB. |
| `maxRedirects` | `5` | Redirect ceiling from 0 through 10. |
| `allowInsecureHttp` | `false` | Enables HTTP only for literal loopback/private addresses and `.localhost` fixture names. |
| `allowedHosts` | Runtime policy | Optional non-empty exact normalized hostname allowlist. Ports are governed by the URL, not the list. |
| `secrets` | none | Trusted string secret record used by `auth`. |

Per-request ceilings are combined with option ceilings using the smaller value. Runtime applies the same tightening rule against execution policy.

## Redirect policy

Every transport call uses `redirect: "manual"`.

- `manual` returns the first redirect response. Add its status to `acceptedStatuses` when it should be a successful result.
- `error` rejects the first redirect.
- `follow` follows only `GET` and `HEAD`, validates every target before contact, rejects HTTPS downgrade, and enforces the effective hop limit.
- Same-origin redirects retain validated headers and managed authentication.
- Cross-origin redirects retain only `Accept`, `Accept-Language`, and the package-managed user agent. Authentication and all custom headers are removed.
- `POST`, `PUT`, `PATCH`, and `DELETE` redirects are rejected without method conversion or replay.

## Retry policy

```js
retry: {
  maxAttempts: 3,
  statuses: [408, 425, 429, 500, 502, 503, 504],
  initialDelayMs: 250,
  maxDelayMs: 5000,
  backoffFactor: 2,
  jitterRatio: 0.2,
  respectRetryAfter: true
}
```

`maxAttempts` includes the initial request. Defaults are three attempts for `GET`, `HEAD`, and `OPTIONS`, and one attempt for every write method. Only safe methods retry transport failures or configured statuses. `Retry-After` seconds and HTTP dates are honored within `maxDelayMs` and the one total deadline. A delay that cannot complete before the deadline produces `HTTP_REQUEST_TIMEOUT` without another request.

## Success result

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "index": 0,
        "data": {
          "status": 200,
          "statusText": "OK",
          "headers": {
            "content-type": "application/json"
          },
          "body": {
            "ok": true
          },
          "bodyBase64": "eyJvayI6dHJ1ZX0=",
          "bodyBytes": 11
        },
        "metadata": {
          "accepted": true,
          "status": 200
        }
      }
    ],
    "summary": {
      "total": 1,
      "success_count": 1,
      "failure_count": 0,
      "metrics": {
        "status": 200
      }
    }
  },
  "error": null,
  "metadata": {
    "contractVersion": "2026-07-11",
    "package": "@maitask/http-request",
    "version": "2.0.0",
    "executionId": null,
    "method": "GET",
    "status": 200,
    "attempts": 1,
    "redirects": 0,
    "executedAt": "2026-07-11T00:00:00.000Z",
    "executionMs": 24
  },
  "citations": []
}
```

`bodyBase64` and `bodyBytes` always describe the exact response bytes. `body` contains strict JSON data, UTF-8 text, or the same Base64 string according to `responseType`. Empty `json` and `text` responses produce `null`; empty Base64 responses produce `""`.

## Failure codes

| Code | Meaning |
| --- | --- |
| `HTTP_REQUEST_VALIDATION` | Input, options, headers, body, status, retry, or data snapshots were invalid. |
| `HTTP_REQUEST_SECRET_UNAVAILABLE` | A named authentication secret was missing or empty. |
| `HTTP_REQUEST_POLICY` | URL scheme, insecure transport, or exact-host policy denied a target. |
| `HTTP_REQUEST_TIMEOUT` | The one total deadline expired during transport, response reading, or backoff. |
| `HTTP_REQUEST_RESPONSE_TOO_LARGE` | Declared or streamed response bytes exceeded the effective ceiling. |
| `HTTP_REQUEST_REDIRECT` | Redirect mode, method, target, downgrade, location, or hop count was rejected. |
| `HTTP_REQUEST_STATUS` | The final status was not accepted and no retry remained. The controlled error may include only the numeric status. |
| `HTTP_REQUEST_RESPONSE_PARSE` | Accepted response bytes were not valid UTF-8 JSON/text for the requested representation. |
| `HTTP_REQUEST_UPSTREAM` | The transport failed without exposing its raw exception. |

Failure results intentionally omit provider response bodies. To inspect a known error response, include its status in `acceptedStatuses` or `acceptedStatusRange`; it will then be parsed and returned as a successful transport result.

## Runtime binary contract

For exact binary and multipart request bodies, the package calls the Maitask Runtime HTTP operation with canonical `bodyBase64`. Runtime must decode those bytes without UTF-8 conversion and must reject requests that supply both `body` and `bodyBase64`. Responses must contain canonical `bodyBase64` and a matching `bodyBytes` count. Node-compatible execution sends the same bytes through fetch.

## Version 2 migration

Version 2 deliberately removes the permissive version 1 surface:

- String input becomes `{ url }`.
- `params` becomes `query`; `data` and raw `body` become one explicit body representation.
- `timeout`, `response_type`, `validate_status`, `retries`, and every snake_case alias are removed.
- Executable `validateStatus` functions are replaced by serializable `acceptedStatuses` or `acceptedStatusRange`.
- Literal auth strings and `$SECRET` substitution are replaced by named secret references.
- `Blob`, `ArrayBuffer`, `FormData`, and `URLSearchParams` inputs are replaced by serializable text, Base64, form, and multipart contracts.
- `blob` and `arraybuffer` response modes are replaced by canonical Base64 plus an exact byte count.
- Retry count becomes total `maxAttempts`, and write-method replay is prohibited.

The package provides no compatibility aliases because accepting ambiguous legacy fields would reintroduce unverified behavior and credential leakage paths.

## Deterministic verification

The mandatory package suite uses loopback fixtures for request bodies, authentication, redirects, retries, timeouts, response limits, strict parsing, exact bytes, and adversarial object/header inputs. It does not require a live third-party service. Live endpoint checks may be used only as optional diagnostics.
