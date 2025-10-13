# @maitask/telegram-bot

Send messages via Telegram Bot API to users and groups.

## Features

- Send text messages to Telegram users and groups
- Support for photos, documents, and other media types
- Markdown and HTML formatting options
- Thread replies and silent notifications
- Custom keyboard markup support

## Configuration

### Required Options

- `bot_token`: Your Telegram bot token from @BotFather
- `chat_id`: Target chat ID (user, group, or channel)

### Optional Options

- `text`: Message text content
- `message_type`: 'text', 'photo', or 'document' (default: 'text')
- `parse_mode`: 'Markdown', 'MarkdownV2', or 'HTML' (default: 'Markdown')
- `reply_to_message_id`: Reply to a specific message
- `disable_notification`: Send silent notification (default: false)
- `disable_web_page_preview`: Disable link previews
- `reply_markup`: Inline keyboard or reply keyboard markup
- `file_url`: URL of photo/document for media messages
- `caption`: Caption for media messages
- `timeout`: Request timeout in milliseconds (default: 30000)

## Usage Examples

### Send Text Message

```javascript
{
  "bot_token": "YOUR_BOT_TOKEN",
  "chat_id": "@your_chat",
  "text": "Hello from Maitask!",
  "parse_mode": "Markdown"
}
```

### Send Photo

```javascript
{
  "bot_token": "YOUR_BOT_TOKEN",
  "chat_id": "@your_chat",
  "file_url": "https://example.com/image.jpg",
  "caption": "This is an image",
  "message_type": "photo"
}
```

### Send Document

```javascript
{
  "bot_token": "YOUR_BOT_TOKEN",
  "chat_id": "@your_chat",
  "file_url": "https://example.com/document.pdf",
  "caption": "This is a document",
  "message_type": "document"
}
```

### Reply with Silent Notification

```javascript
{
  "bot_token": "YOUR_BOT_TOKEN",
  "chat_id": "@your_chat",
  "text": "Replying to message",
  "reply_to_message_id": 123456,
  "disable_notification": true
}
```

## Return Value

Success response:
```javascript
{
  "success": true,
  "message_id": 12345,
  "chat_id": -1001234567890,
  "data": { /* Telegram API response */ },
  "metadata": {
    "version": "0.1.0",
    "timestamp": "2025-01-27T10:30:00.000Z",
    "method": "sendMessage"
  }
}
```

Error response:
```javascript
{
  "success": false,
  "error": {
    "message": "Error details",
    "code": "TELEGRAM_ERROR",
    "type": "TelegramBotError"
  }
}
```