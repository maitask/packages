# @maitask/excel-exporter

Convert tabular data into CSV that Excel and downstream adapters can open.

## Features

- Detects arrays of objects, arrays of arrays, or primitive values
- Optional custom column headers
- Returns rows, a CSV body, and a suggested filename
- Does not write host files or invent an `.xlsx` binary

## Input

An array of objects, an array of arrays, or primitive values.

Optional:

- `filename` or `path` — suggested download name (`.xlsx` is rewritten to `.csv`)
- `sheet_name` — recorded in summary metadata
- `headers` — custom column headers

## Example

```json
{
  "input": [
    {"name": "Alice", "team": "Research", "score": 92},
    {"name": "Bob", "team": "Growth", "score": 88}
  ],
  "options": {
    "filename": "reports/quarterly-scorecard.csv",
    "sheet_name": "Q4 Metrics"
  }
}
```

## Output

```json
{
  "success": true,
  "data": {
    "items": [{"name": "Alice", "team": "Research", "score": 92}],
    "summary": {
      "format": "csv",
      "filename": "reports/quarterly-scorecard.csv",
      "sheetName": "Q4 Metrics",
      "rowCount": 1,
      "columnCount": 3
    },
    "csv": "name,team,score\nAlice,Research,92"
  }
}
```

## License

MIT
