# @maitask/kafka-publisher

Publish one or more records through a Confluent-compatible Kafka REST Proxy JSON endpoint.

## Contract

`execute(input, options?, context?)` returns `Promise<KafkaResult>`. `input` is an object with the following fields:

| Field | Type | Required | Behavior |
| --- | --- | --- | --- |
| `topic` | string | Yes | Trimmed and appended to the REST Proxy `/topics/{topic}` path. |
| `messages` | JSON value or JSON value array | Yes | Null entries in a batch are discarded; at least one entry must remain. |
| `key` | JSON value | No | Non-null values are converted to a string and applied to every record. |
| `headers` | object | No | Non-null values are converted to strings and added as HTTP request headers. |
| `proxyUrl` | string | Conditional | REST Proxy base URL. Takes precedence over `options.proxyUrl`. |
| `timeoutMs` | number | No | Takes precedence over `options.timeoutMs`. |

The public options are the fallback fields `proxyUrl` and `timeoutMs`; other option fields are not used. `context` is currently unused. `proxyUrl` is required after input/options fallback resolution.

The timeout defaults to 30000 milliseconds when the selected value is missing, non-finite, or not positive. Positive values are clamped to 120000 milliseconds.

```json
{
  "input": {
    "topic": "user.events",
    "messages": [
      {
        "event": "signup",
        "userId": "u-1"
      },
      "user session refreshed"
    ],
    "key": "u-1",
    "headers": {
      "X-Trace-Source": "maitask"
    }
  },
  "options": {
    "proxyUrl": "https://kafka-proxy.internal",
    "timeoutMs": 30000
  }
}
```

## REST Proxy serialization

The package sends one `POST` with content type `application/vnd.kafka.json.v2+json` and a body shaped as `{"records":[...]}`. A string message is sent unchanged as the record `value`; every other JSON message is serialized with `JSON.stringify` and sent as a string. The shared `key` is either a string or `null`.

The package currently performs no automatic retry. It also does not add redirect restrictions or sanitize arbitrary header values and proxy URLs from errors; callers must avoid placing secrets in returned provider messages and must treat `headers` as sensitive configuration when they contain credentials.

## Results

```json
{
  "success": true,
  "data": {
    "topic": "user.events",
    "count": 2,
    "offsets": [
      {
        "partition": 0,
        "offset": 101
      }
    ]
  },
  "metadata": {
    "proxyUrl": "https://kafka-proxy.internal",
    "timestamp": "2026-07-10T00:00:00.000Z",
    "version": "0.1.0"
  }
}
```

`offsets` is the REST Proxy response array passed through without field translation. Confluent-compatible entries commonly contain `partition` and `offset`; provider error entries may contain the wire field `error_code` and `error`. These are response wire fields, not Maitask input or option names. A missing or non-array response `offsets` value becomes an empty array.

Failures use the current fixed code `KAFKA_PUBLISHER_ERROR` and type `KafkaPublisherError`:

```json
{
  "success": false,
  "error": {
    "message": "broker unavailable",
    "code": "KAFKA_PUBLISHER_ERROR",
    "type": "KafkaPublisherError"
  },
  "metadata": {
    "timestamp": "2026-07-10T00:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Regression verification

Mandatory package regression uses a controlled loopback REST Proxy fixture and does not depend on a live Kafka cluster. A live provider smoke check is optional diagnostics only and is not the package success-path release gate.
