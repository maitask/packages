# @maitask/slack-notifier

Send text, Block Kit layouts, and attachment-compatible JSON through a Slack Incoming Webhook.

## Contract

`execute(input, options?, context?)` returns `Promise<SlackResult>`. `input` is either a non-blank string or a plain object containing only `text`, `blocks`, and `attachments`. `blocks` and `attachments` must be non-empty arrays of plain objects. A message must contain non-blank text, at least one block, or at least one attachment.

The exact option allowlist is `webhookUrl`, `threadTs`, `channel`, `username`, `iconEmoji`, `iconUrl`, `linkNames`, `mrkdwn`, and `timeoutMs`. Message content belongs in `input`, and legacy or unknown fields are rejected.

- `webhookUrl` may be provided explicitly or through `context.secrets.SLACK_WEBHOOK_URL`.
- `username` defaults to `Maitask Bot`.
- `iconEmoji` defaults to `:robot_face:` when neither icon option is set. Explicit `iconEmoji` and `iconUrl` are mutually exclusive.
- `linkNames` and `mrkdwn` both default to `true`.
- `timeoutMs` defaults to 30000, must be positive and finite, and is clamped to 120000.

```json
{
  "input": {
    "text": "Deployment succeeded",
    "blocks": [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*Deployment:* succeeded"
        }
      }
    ],
    "attachments": [
      {
        "color": "#36C5F0",
        "text": "Version 1.4.2"
      }
    ]
  },
  "options": {
    "channel": "#deployments",
    "username": "Release Bot",
    "threadTs": "1700000000.000001",
    "iconEmoji": ":rocket:",
    "linkNames": true,
    "mrkdwn": true,
    "timeoutMs": 30000
  },
  "context": {
    "secrets": {
      "SLACK_WEBHOOK_URL": "<runtime-secret>"
    }
  }
}
```

## Provider wire mapping

Maitask input and options remain camelCase. The outgoing Slack JSON translates `threadTs`, `iconEmoji`, `iconUrl`, and `linkNames` to the wire fields `thread_ts`, `icon_emoji`, `icon_url`, and `link_names`. Block Kit and attachment objects are provider-defined JSON and retain Slack's own field names. Wire field names are not accepted as top-level Maitask input or options.

## Delivery and results

Each execution performs one JSON `POST`. The package does not retry automatically and refuses redirects. Slack must return an HTTP success response whose body is `ok` after trimming and case normalization.

```json
{
  "success": true,
  "data": {
    "webhook": "https://hooks.slack.com/services/T***/B***/***",
    "username": "Release Bot",
    "icon": ":rocket:",
    "channel": "#deployments",
    "threadTs": "1700000000.000001",
    "hasBlocks": true,
    "hasAttachments": true
  },
  "metadata": {
    "package": "@maitask/slack-notifier",
    "version": "0.1.0",
    "provider": "slack",
    "webhook": "https://hooks.slack.com/services/T***/B***/***",
    "responseStatus": 200,
    "responseTimeMs": 145,
    "timestamp": "2026-07-10T00:00:00.000Z"
  }
}
```

Failures use code `SLACK_ERROR` and type `SlackNotificationError`. Provider failures may include `status` and `retriable`. A valid HTTP 429 `Retry-After` header is exposed as `details.retryAfterSeconds`; timeout failures expose `details.timeoutMs`. `retriable` is classification for the caller, not evidence of an automatic retry.

Webhook URLs are masked in data and metadata. Provider error text is normalized, bounded, and sanitized to remove webhook path secrets and arbitrary URLs; network errors are returned as a generic message.

## Regression verification

Mandatory package regression uses controlled loopback fixtures and does not depend on Slack availability. A live Slack webhook smoke check is optional diagnostics only and is not the package success-path release gate.
