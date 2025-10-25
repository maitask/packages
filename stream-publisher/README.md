# @maitask/stream-publisher

Publish data streams via HTTP chunked transfer encoding or Server-Sent Events (SSE) for real-time communication.

## Features

- **HTTP Chunked Transfer**: Send data as line-delimited JSON (NDJSON)
- **Server-Sent Events (SSE)**: Standard SSE format with event IDs
- **Real-time Streaming**: Push data updates progressively
- **Custom Headers**: Add authentication and custom HTTP headers
- **Configurable**: Adjust chunk sizes, timeouts, and event names
- **Production Ready**: High-performance reliable streaming

## Installation

```bash
maitask install @maitask/stream-publisher
```

## Usage

### Basic Streaming

```bash
# Stream sensor data (chunked mode)
echo '[{"temp":25.5},{"temp":26.3},{"temp":24.8}]' | maitask run @maitask/stream-publisher --config '{"url":"https://api.example.com/stream"}'

# Stream using SSE format
maitask run @maitask/stream-publisher --input events.json --config '{"url":"https://api.example.com/sse","mode":"sse"}'
```

### API Usage

```bash
curl -X POST http://localhost:8080/packages/@maitask/stream-publisher/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {"sensor": "temp_01", "value": 25.5, "timestamp": "2025-09-30T14:00:00Z"},
      {"sensor": "temp_01", "value": 26.3, "timestamp": "2025-09-30T14:01:00Z"}
    ],
    "options": {
      "url": "https://api.example.com/stream",
      "mode": "chunked",
      "headers": {"Authorization": "Bearer token123"}
    }
  }'
```

## Modes

### Chunked Transfer (Default)

Sends data as line-delimited JSON (NDJSON):

```
{"sensor":"temp_01","value":25.5}
{"sensor":"temp_01","value":26.3}
{"sensor":"temp_01","value":24.8}
```

### Server-Sent Events (SSE)

Standard SSE format with event IDs:

```
id: 1
event: message
data: {"sensor":"temp_01","value":25.5}

id: 2
event: message
data: {"sensor":"temp_01","value":26.3}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | **required** | Stream endpoint URL |
| `mode` | string | `chunked` | Stream mode: `chunked` or `sse` |
| `headers` | object | `{}` | Custom HTTP headers |
| `chunk_size` | number | `65536` | Chunk size in bytes (chunked mode) |
| `timeout_seconds` | number | `300` | Request timeout in seconds |
| `event_name` | string | `message` | Event name for SSE mode |
| `auth_token` | string | - | Bearer token (auto-adds to headers) |
| `include_response_body` | boolean | `true` | Include server response body |

## Input Format

### Array of Objects

```json
[
  {"event": "user.login", "user_id": 123, "timestamp": "2025-09-30T14:00:00Z"},
  {"event": "user.logout", "user_id": 123, "timestamp": "2025-09-30T15:30:00Z"}
]
```

### Array of Primitives

```json
[25.5, 26.3, 24.8, 27.1]
```

### Single Object

```json
{"status": "update", "data": {...}}
```

## Output Format

```json
{
  "success": true,
  "publisher": "stream",
  "mode": "chunked",
  "format": "application/x-ndjson",
  "output_adapter": {
    "adapter": "http_stream",
    "config": {...},
    "data": [...]
  },
  "preview": {
    "eventCount": 3,
    "totalSize": 195,
    "sample": [...]
  },
  "statistics": {
    "totalEvents": 3,
    "estimatedBytes": 195,
    "chunkSize": 65536,
    "mode": "chunked"
  },
  "metadata": {
    "endpoint": "https://api.example.com/stream",
    "mode": "chunked",
    "eventName": "message",
    "hasAuth": true,
    "publishedAt": "2025-09-30T14:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Examples

### Real-time Sensor Data

```javascript
{
  "input": [
    {"sensor": "temp_01", "value": 25.5, "unit": "C"},
    {"sensor": "temp_01", "value": 26.3, "unit": "C"},
    {"sensor": "temp_01", "value": 24.8, "unit": "C"}
  ],
  "options": {
    "url": "https://iot.example.com/stream",
    "mode": "chunked",
    "headers": {
      "X-Device-ID": "sensor_001"
    }
  }
}
```

### Live Dashboard Updates (SSE)

```javascript
{
  "input": [
    {"metric": "cpu_usage", "value": 45.2},
    {"metric": "memory_usage", "value": 68.5},
    {"metric": "disk_usage", "value": 82.1}
  ],
  "options": {
    "url": "https://dashboard.example.com/events",
    "mode": "sse",
    "event_name": "metrics_update",
    "auth_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Log Streaming

```javascript
{
  "input": [
    {"level": "info", "message": "Server started", "timestamp": "2025-09-30T14:00:00Z"},
    {"level": "warn", "message": "High memory usage", "timestamp": "2025-09-30T14:01:00Z"}
  ],
  "options": {
    "url": "https://logs.example.com/stream",
    "mode": "chunked",
    "chunk_size": 32768,
    "headers": {
      "Content-Type": "application/x-ndjson",
      "X-Log-Source": "production"
    }
  }
}
```

## Performance

- **Latency**: ~1-2 seconds per stream session
- **Throughput**: Depends on network and server capacity
- **Chunk Size**: Larger chunks reduce overhead, smaller chunks improve real-time feel
- **Timeout**: Adjust based on expected stream duration

## Error Handling

```json
{
  "success": false,
  "error": {
    "message": "Stream endpoint URL is required (options.url)",
    "code": "STREAM_PUBLISH_ERROR",
    "type": "StreamPublishError"
  },
  "metadata": {
    "publishedAt": "2025-09-30T14:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Integration with Adapters

This package uses the engine's HTTP Stream adapter. The output includes `output_adapter` configuration that the engine automatically processes.

```javascript
// Package output structure
{
  "output_adapter": {
    "adapter": "http_stream",
    "config": { "url": "...", "mode": "chunked" },
    "data": [...]
  }
}

// Engine automatically sends data via HTTP Stream adapter
```

## Use Cases

- **IoT Data Streaming**: Real-time sensor data to dashboards
- **Live Dashboards**: Push metrics and analytics updates
- **Event Broadcasting**: Stream events to subscribers
- **Log Aggregation**: Stream logs to centralized services
- **Progress Updates**: Report long-running task progress
- **Live Notifications**: Push notifications to clients

## Comparison: Chunked vs SSE

| Feature | Chunked | SSE |
|---------|---------|-----|
| Format | NDJSON | SSE standard |
| Browser Support | Fetch API | EventSource API |
| Event IDs | No | Yes |
| Reconnection | Manual | Automatic |
| Overhead | Lower | Higher |
| Use Case | API-to-API | Browser clients |

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/maitask/packages/issues)
- **Documentation**: [Maitask Docs](https://docs.maitask.com)
- **Community**: [Discord](https://discord.gg/maitask)