# @maitask/cron-parser

Cron expression parser and scheduler for Maitask.

## Features

- Parse standard cron expressions (5 or 6 fields)
- Calculate next execution times
- Validate cron syntax
- Human-readable descriptions
- Support ranges, lists, steps, wildcards

## Operations

### Parse

Parse cron expression into structured format:

```bash
echo '0 9 * * 1-5' | maitask run @maitask/cron-parser
```

### Next Runs

Calculate next N execution times:

```bash
echo '0 9 * * 1-5' | maitask run @maitask/cron-parser --options '{"operation":"next","count":10}'
```

### Validate

Validate cron expression:

```bash
echo '0 9 * * 1-5' | maitask run @maitask/cron-parser --options '{"operation":"validate"}'
```

### Describe

Get human-readable description:

```bash
echo '0 9 * * 1-5' | maitask run @maitask/cron-parser --options '{"operation":"describe"}'
```

## Cron Format

### Standard (5 fields)

```text
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-6, 0=Sunday)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)
```

### With Seconds (6 fields)

```text
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └─ Day of week (0-6)
│ │ │ │ └─── Month (1-12)
│ │ │ └───── Day of month (1-31)
│ │ └─────── Hour (0-23)
│ └───────── Minute (0-59)
└─────────── Second (0-59)
```

## Special Characters

- `*` - All values
- `,` - List (e.g., `1,3,5`)
- `-` - Range (e.g., `1-5`)
- `/` - Step (e.g., `*/5` = every 5 units)

## Examples

- `0 0 * * *` - Daily at midnight
- `0 9 * * 1-5` - Weekdays at 9 AM
- `*/15 * * * *` - Every 15 minutes
- `0 0 1 * *` - First day of month at midnight
- `0 12 * * 0` - Every Sunday at noon

## License

MIT
