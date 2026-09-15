# @maitask/stream-publisher

Publish NDJSON or SSE event streams to an HTTPS endpoint.

## Features

- POSTs line-delimited JSON (`chunked`) or SSE (`sse`) bodies
- Bearer tokens via `tokenSecret` and Runtime secrets
- Rejects embedded URL credentials
- HTTPS required unless `allowInsecureHttp` is set

## Options

- `url` — HTTPS endpoint
- `mode` — `chunked` (default) or `sse`
- `tokenSecret` — name of a Runtime secret used as a bearer token
- `event_name` — SSE event name
- `headers` — additional request headers
- `timeoutMs` — request timeout
- `allowInsecureHttp` — permit `http:` URLs

## Example

```json
{
  "input": [{"event": "user.login", "userId": "u-1001"}],
  "options": {
    "url": "https://events.example.com/ingest",
    "mode": "sse",
    "event_name": "maitask-event",
    "tokenSecret": "STREAM_TOKEN"
  }
}
```

## License

MIT
