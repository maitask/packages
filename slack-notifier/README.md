# @maitask/slack-notifier

Send notifications and messages to Slack channels via incoming webhooks.

## Features

- **Simple Text Messages**: Quick notifications with plain text
- **Block Kit Support**: Rich messages with modern Slack layouts
- **Attachments**: Legacy format with colors and fields
- **Thread Replies**: Reply to existing messages in threads
- **Markdown Formatting**: Bold, italic, code, and links
- **Custom Bot**: Configure bot name and icon
- **Production Ready**: Error handling and webhook URL masking

## Installation

```bash
maitask install @maitask/slack-notifier
```

## Usage

### Simple Text Message

```bash
echo "Deployment completed successfully" | maitask run @maitask/slack-notifier \
  --config '{"webhook_url":"https://hooks.slack.com/services/T.../B.../..."}'
```

### Rich Message with Blocks

```bash
maitask run @maitask/slack-notifier --input notification.json
```

**notification.json**:
```json
{
  "webhook_url": "https://hooks.slack.com/services/T.../B.../...",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚀 Deployment Alert"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Status:* Success\n*Environment:* Production\n*Duration:* 2m 34s"
      }
    }
  ]
}
```

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `webhook_url` | string | Yes | Slack incoming webhook URL |
| `text` | string | No | Message text (fallback for blocks) |
| `blocks` | array | No | Block Kit layout objects |
| `attachments` | array | No | Legacy attachments |
| `thread_ts` | string | No | Thread timestamp for replies |
| `username` | string | No | Bot display name (default: "Maitask Bot") |
| `icon_emoji` | string | No | Bot emoji icon (default: ":robot_face:") |
| `icon_url` | string | No | Bot image URL |
| `channel` | string | No | Override default channel |
| `link_names` | boolean | No | Link @mentions (default: true) |
| `mrkdwn` | boolean | No | Enable markdown (default: true) |

## Examples

### Alert Notification

```json
{
  "webhook_url": "https://hooks.slack.com/services/...",
  "text": "⚠️ High CPU usage detected on server-prod-01",
  "attachments": [
    {
      "color": "warning",
      "fields": [
        {"title": "Server", "value": "server-prod-01", "short": true},
        {"title": "CPU", "value": "87%", "short": true},
        {"title": "Memory", "value": "6.2GB / 8GB", "short": true},
        {"title": "Time", "value": "2025-09-30 14:32:15", "short": true}
      ]
    }
  ]
}
```

### Thread Reply

```json
{
  "webhook_url": "https://hooks.slack.com/services/...",
  "text": "Build completed successfully ✅",
  "thread_ts": "1234567890.123456"
}
```

## Output Format

```json
{
  "success": true,
  "notifier": "slack",
  "message": "Slack notification sent successfully",
  "data": {
    "webhook": "https://hooks.slack.com/services/T***/B***/***",
    "channel": "default",
    "username": "Maitask Bot",
    "icon": ":robot_face:",
    "has_blocks": true,
    "has_attachments": false,
    "thread_ts": null,
    "sent_at": "2025-09-30T14:32:15.123Z"
  },
  "metadata": {
    "response_status": 200,
    "response_time_ms": 145,
    "version": "0.1.0"
  }
}
```

## Error Handling

```json
{
  "success": false,
  "error": {
    "message": "Slack API error: 404 - channel_not_found",
    "code": "SLACK_ERROR",
    "type": "SlackNotificationError"
  },
  "metadata": {
    "webhook": "https://hooks.slack.com/services/***",
    "sent_at": "2025-09-30T14:32:15.123Z",
    "version": "0.1.0"
  }
}
```

## Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Add webhook to workspace
4. Copy webhook URL to your configuration

## Rate Limits

- **Limit**: 1 message per second (short bursts allowed)
- **Max Attachments**: 100 per message
- **Text Length**: Up to 40,000 characters

## Security

- Webhook URLs contain secrets - never commit to version control
- Use environment variables: `SLACK_WEBHOOK_URL`
- URLs are automatically masked in responses

## License

MIT License - see LICENSE file for details