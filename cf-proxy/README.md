# @maitask/cf-proxy

Cloudflare Worker-style proxy for GitHub and Docker registry acceleration with intelligent redirect handling and AWS S3 signature support.

## Features

- ✅ GitHub file acceleration
- ✅ Docker registry mirroring (Docker Hub, GHCR, Quay.io, GCR)
- ✅ Intelligent redirect handling (302/307)
- ✅ Docker authentication (Bearer tokens)
- ✅ AWS S3 signature headers
- ✅ Domain and path whitelisting
- ✅ Configurable redirect limits

## Installation

```bash
maitask install @maitask/cf-proxy
```

## Usage

### Basic GitHub File Proxying

```json
{
  "url": "https://github.com/user/repo/releases/download/v1.0.0/file.tar.gz"
}
```

### Docker Image Proxying

```json
{
  "url": "https://ghcr.io/v2/user/repo/manifests/latest",
  "method": "GET",
  "headers": {
    "Accept": "application/vnd.docker.distribution.manifest.v2+json"
  }
}
```

### Custom Configuration

```json
{
  "url": "https://quay.io/v2/user/repo/blobs/sha256:abc123...",
  "config": {
    "allowedHosts": [
      "quay.io",
      "github.com"
    ],
    "restrictPaths": true,
    "allowedPaths": ["user", "repo"],
    "maxRedirects": 10
  }
}
```

## Configuration Options

### `config.allowedHosts` (string[])

Whitelist of allowed domains. Default includes:

- `github.com`, `api.github.com`, `raw.githubusercontent.com`
- `registry-1.docker.io`, `ghcr.io`, `quay.io`, `gcr.io`
- `k8s.gcr.io`, `registry.k8s.io`, `docker.cloudsmith.io`

### `config.restrictPaths` (boolean)

Enable path restrictions. Default: `false`

### `config.allowedPaths` (string[])

Allowed path keywords when `restrictPaths` is `true`. Default: `['library']`

### `config.maxRedirects` (number)

Maximum number of redirects to follow. Default: `5`

## Response Format

```json
{
  "success": true,
  "status": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/octet-stream",
    "content-length": "12345"
  },
  "body": "...",
  "metadata": {
    "targetDomain": "github.com",
    "targetPath": "user/repo/releases/download/v1.0.0/file.tar.gz",
    "isDockerRequest": false,
    "isS3": false,
    "redirectCount": 0,
    "timestamp": "2025-10-03T15:30:00.000Z"
  }
}
```

## Docker Registry Support

The proxy automatically handles Docker V2 API authentication:

1. Detects 401 authentication challenges
2. Extracts Bearer realm, service, and scope
3. Requests authentication token
4. Retries request with Bearer token

### Supported Registries

- Docker Hub (`registry-1.docker.io`)
- GitHub Container Registry (`ghcr.io`)
- Quay.io (`quay.io`)
- Google Container Registry (`gcr.io`, `k8s.gcr.io`, `registry.k8s.io`)
- Docker Cloudsmith (`docker.cloudsmith.io`)

## AWS S3 Support

Automatically adds required headers when proxying to AWS S3:

- `x-amz-content-sha256`: SHA256 hash of empty body
- `x-amz-date`: ISO 8601 timestamp

## Error Handling

The package throws errors for:

- Missing URL
- Domain not in whitelist
- Path not in allowed paths (when restrictPaths is true)
- Max redirects exceeded

Example error:

```json
{
  "error": "Domain example.com not in allowed list"
}
```

## Example Use Cases

### 1. GitHub Release Acceleration

```javascript
await execute('@maitask/cf-proxy', {
  url: 'https://github.com/maitask/engine/releases/download/v1.0.0/engine-linux-amd64.tar.gz'
});
```

### 2. Docker Image Pull

```javascript
// Get manifest
const manifest = await execute('@maitask/cf-proxy', {
  url: 'https://ghcr.io/v2/maitask/engine/manifests/latest',
  headers: {
    'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
  }
});

// Get layer blob
const layer = await execute('@maitask/cf-proxy', {
  url: 'https://ghcr.io/v2/maitask/engine/blobs/' + digest
});
```

### 3. Custom Domain Whitelist

```javascript
await execute('@maitask/cf-proxy', {
  url: 'https://custom-registry.example.com/v2/repo/manifests/tag',
  config: {
    allowedHosts: ['custom-registry.example.com'],
    maxRedirects: 3
  }
});
```

## Security

- **Domain Whitelisting**: Only configured domains are allowed
- **Path Restrictions**: Optional path-based access control
- **No Credential Storage**: Authentication tokens are not persisted
- **Redirect Limits**: Prevents infinite redirect loops

## Performance

- Intelligent redirect handling reduces unnecessary round trips
- AWS S3 signature pre-computation
- Connection reuse via HTTP helpers
- Minimal overhead for proxying

## License

MIT

## Support

- GitHub Issues: <https://github.com/maitask/packages/issues>
- Documentation: <https://docs.maitask.com>
