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
| `proxyUrl` | string | Conditional | REST Proxy base URL. An own input field takes precedence over `options.proxyUrl`. |
| `timeoutMs` | number | No | An own input field takes precedence over `options.timeoutMs`. |

The public options are the fallback fields `proxyUrl` and `timeoutMs`; other option fields are not used. An own input field is authoritative even when its value is `undefined`, `null`, or otherwise invalid, so explicit invalid input does not fall back to `options`. `proxyUrl` is required after input/options selection.

The optional third argument accepts an opaque Runtime context object, including readonly Runtime fields such as `executionId`. The package currently does not read any context field; context is not part of the input/options configuration contract.

When neither input nor options supplies `timeoutMs`, the timeout defaults to 30000 milliseconds. A selected timeout must be a finite positive number; invalid explicit values return a structured failure instead of using a fallback or default. Positive values are clamped to 120000 milliseconds.

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

Readonly messages, keys, and headers, including deeply nested `as const` JSON, are accepted. The package snapshots input and options and deep-copies message, key, and header JSON before serialization. Accessors and behavioral `toJSON` functions are rejected without invocation; cycles, non-finite numbers, custom object structures, and other non-JSON values are also rejected.

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

Successful HTTP responses must contain a valid plain-object envelope with an `offsets` array. Every offset requires a non-negative safe-integer `partition` and at least one result: a non-negative safe-integer `offset`, or an integer provider error code paired with a string error message. Malformed envelopes and invalid offset entries return the normal structured failure result.

Result offsets expose only the known camelCase fields `partition`, `offset`, `errorCode`, and `error`; unknown provider fields do not enter the result. On the REST Proxy wire, the provider field `error_code` is accepted and translated to `errorCode`.

Unknown provider response data fields are omitted without traversing their values; response accessors still invalidate the envelope. For a non-success HTTP response, the package extracts only an own string `message` or an own nested string `error.message`; otherwise it returns the controlled status fallback.

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
