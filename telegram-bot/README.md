# @maitask/telegram-bot

Send a text message, photo, or document through the Telegram Bot API.

## Contract

`execute(input, options, context?)` returns `Promise<TelegramResult>`. `input` is either a string or a plain object with only `text`, `fileUrl`, and `caption`.

- `messageType` is `text` by default and accepts `text`, `photo`, or `document`.
- Text delivery requires non-blank `text`.
- Photo and document delivery require non-blank `fileUrl`. `caption` is used when present; otherwise `text` becomes the caption.
- `chatId` is required and accepts a non-empty string or safe integer.
- `parseMode` defaults to `Markdown`; the formal values are `Markdown`, `MarkdownV2`, and `HTML`.
- `disableNotification` defaults to `false`. `disableWebPagePreview` applies only to text messages.
- `replyToMessageId` must be a positive integer. `replyMarkup` must be a plain JSON object.
- `timeoutMs` defaults to 30000, must be positive and finite, and is clamped to 120000.

The exact option allowlist is `baseUrl`, `botToken`, `chatId`, `messageType`, `parseMode`, `replyToMessageId`, `disableNotification`, `disableWebPagePreview`, `replyMarkup`, and `timeoutMs`. Message content does not belong in `options`.

## Authentication and endpoint selection

Prefer the Runtime secret `context.secrets.TELEGRAM_BOT_TOKEN`. An explicit `options.botToken` takes precedence. `options.baseUrl` takes precedence over `context.env.TELEGRAM_API_BASE_URL`; otherwise the package uses `https://api.telegram.org`.

`baseUrl` must be an absolute HTTP or HTTPS URL without credentials, query parameters, or a fragment. A delivery performs one JSON `POST`; the package does not retry automatically and refuses redirects.

```json
{
  "input": {
    "fileUrl": "https://assets.example/release.png",
    "text": "Release complete"
  },
  "options": {
    "chatId": "@release_updates",
    "messageType": "photo",
    "parseMode": "MarkdownV2",
    "disableNotification": false,
    "timeoutMs": 30000
  },
  "context": {
    "secrets": {
      "TELEGRAM_BOT_TOKEN": "<runtime-secret>"
    }
  }
}
```

## Provider wire mapping

Maitask configuration remains camelCase. The package translates it to Telegram wire fields such as `chat_id`, `parse_mode`, `reply_to_message_id`, `disable_notification`, `disable_web_page_preview`, and `reply_markup`. These wire names are not accepted in `input` or `options`.

## Results and errors

Successful output contains only validated delivery fields rather than the complete Telegram response:

```json
{
  "success": true,
  "data": {
    "messageId": 42,
    "chatId": -1001,
    "caption": "Release complete"
  },
  "metadata": {
    "package": "@maitask/telegram-bot",
    "version": "0.1.0",
    "provider": "telegram",
    "method": "sendPhoto",
    "timestamp": "2026-07-10T00:00:00.000Z"
  }
}
```

Failures use code `TELEGRAM_ERROR` and type `TelegramBotError`. They may include `status`, `retriable`, and either `details.retryAfterSeconds` for a valid provider rate-limit hint or `details.timeoutMs` for a timeout. `retriable` classifies the failure for the caller; it does not mean the package retried the POST. Provider messages are sanitized so bot tokens and URLs do not appear in returned errors, and success output never contains the bot token.

## Regression verification

Mandatory package regression uses controlled loopback fixtures and does not depend on Telegram availability. A live Telegram smoke check is optional diagnostics only and is not the package success-path release gate.
