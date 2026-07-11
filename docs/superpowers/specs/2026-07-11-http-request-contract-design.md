# HTTP Request Contract Design

## Goal

Replace the permissive HTTP wrapper with a deterministic general-purpose client whose request data, credentials, redirects, retries, response bytes, and failures remain inside explicit production boundaries.

## Public contract

`input` is one strict camelCase request object. It supports absolute HTTP or HTTPS URLs, `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, repeated query values, validated request headers, secret-backed bearer, Basic, and API-key authentication, JSON, UTF-8 text, exact Base64, URL-encoded, and multipart bodies, three response representations, accepted-status policy, redirect policy, and safe-method retry policy.

The body fields `json`, `text`, `bodyBase64`, `form`, and `multipart` are mutually exclusive. `GET` and `HEAD` cannot carry bodies. Response representations are `json`, `text`, and `base64`; every successful response also contains canonical `bodyBase64` and the exact `bodyBytes` count. JSON responses must contain valid UTF-8 JSON and never silently fall back to text.

Legacy string input, merged input/options, snake_case fields, field aliases, executable status validators, live `Blob`, `ArrayBuffer`, `FormData`, and literal authentication values are rejected. Version 2 is an intentional formal contract break.

## Trusted options and secrets

`options` contains transport ceilings and trusted secret values: `timeoutMs`, `maxResponseBytes`, `maxRedirects`, `allowInsecureHttp`, `allowedHosts`, and `secrets`. Per-request `timeoutMs`, `maxResponseBytes`, and `maxRedirects` may tighten but never loosen the option ceilings. Secrets are resolved by exact name from `options.secrets` and then `context.secrets`; missing, empty, inherited, accessor-backed, or non-string secrets fail before network access.

Authentication is declared in `input.auth` and always refers to named secrets. Caller headers cannot set `Authorization`, `Cookie`, `Proxy-Authorization`, `Host`, `Content-Length`, transfer or connection headers, or the managed API-key header. The package never copies resolved secrets into metadata or failures. Successful response bytes remain exact; an upstream that deliberately echoes request credentials can therefore place them in its own accepted response, as with any byte-preserving HTTP client.

## URL and redirect policy

URLs must be absolute, contain no embedded credentials or fragments, and use HTTPS. Trusted `allowInsecureHttp` may enable HTTP only for literal loopback or private fixture addresses. Optional `allowedHosts` contains exact normalized hostnames and is applied to the initial URL and every redirect target; Runtime network policy remains an additional boundary.

All transport calls use `redirect: "manual"`. `manual` returns the redirect response subject to accepted-status policy, `error` rejects every redirect, and `follow` follows at most the effective redirect limit. Only `GET` and `HEAD` are followed. HTTPS downgrade is rejected. Same-origin redirects retain request headers and authentication; cross-origin redirects discard authentication and every caller-supplied header except `Accept` and `Accept-Language`. Redirect targets are validated before contact.

## Retry and deadline policy

The package uses one total deadline for retries, backoff, redirects, response headers, and response body reading. Timeout and response-size values are forwarded to Runtime as tighter per-call limits and are independently enforced for Node-compatible fetch implementations.

Automatic retries are limited to `GET`, `HEAD`, and `OPTIONS`. `POST`, `PUT`, `PATCH`, and `DELETE` are never replayed after a timeout, network failure, redirect, or retryable status. The configurable retry policy controls total attempts, retryable statuses, exponential backoff, optional jitter, and bounded `Retry-After` handling. The default is three total attempts for safe methods and one attempt for all other methods.

## Data and error boundaries

Input, options, authentication, headers, query values, retry policy, status policy, multipart values, JSON values, and secret containers are synchronously copied from own data descriptors. Accessors, symbols, custom prototypes, cycles, unsupported values, sparse arrays, dangerous header values, duplicate case-insensitive headers, and unknown fields are rejected before network access.

Response bytes are collected exactly once under the effective size ceiling. Response headers are normalized into detached lower-case string records. Success data uses the standard `items` and `summary` boundary. A non-accepted status returns only controlled status metadata; callers that require an error response body can explicitly accept that status.

Failures use stable `HTTP_REQUEST_VALIDATION`, `HTTP_REQUEST_SECRET_UNAVAILABLE`, `HTTP_REQUEST_POLICY`, `HTTP_REQUEST_TIMEOUT`, `HTTP_REQUEST_RESPONSE_TOO_LARGE`, `HTTP_REQUEST_REDIRECT`, `HTTP_REQUEST_STATUS`, `HTTP_REQUEST_RESPONSE_PARSE`, and `HTTP_REQUEST_UPSTREAM` codes. Failure messages and details never contain request URLs, credentials, caller bodies, response bodies, raw exception messages, or arbitrary provider data.

## Verification

Deterministic loopback fixtures cover every request body representation, exact binary response fidelity, query and header normalization, each authentication scheme, unresolved secrets, strict snapshots, protected headers, safe and unsafe method retry behavior, total timeout during headers/body/backoff, response limits, redirect modes, same-origin credential retention, cross-origin credential and header removal, redirect target refusal with zero target requests, accepted statuses, JSON parse failures, stable errors, and readonly TypeScript contracts. Live third-party calls are not part of the mandatory gate.
