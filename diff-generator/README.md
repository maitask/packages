# @maitask/diff-generator

Data difference comparison and patch generation for Maitask.

## Features

- JSON object comparison
- Text line-by-line diff (LCS algorithm)
- Array difference detection
- Change type classification
- Summary statistics
- Auto mode detection

## Modes

### JSON Mode

Compare objects and detect added, removed, or modified properties:

```bash
echo '{"old":{"a":1,"b":2},"new":{"a":1,"b":3,"c":4}}' | maitask run @maitask/diff-generator
```

### Text Mode

Line-by-line text comparison:

```bash
echo '{"old":"line1\nline2","new":"line1\nline3"}' | maitask run @maitask/diff-generator --options '{"mode":"text"}'
```

### Array Mode

Detect added and removed array elements:

```bash
echo '{"old":[1,2,3],"new":[2,3,4]}' | maitask run @maitask/diff-generator --options '{"mode":"array"}'
```

## Input Format

```json
{
  "old": <original data>,
  "new": <updated data>
}
```

Alternative keys: `before`/`after`, `source`/`target`

## Output Example

### JSON Diff

```json
{
  "success": true,
  "mode": "json",
  "changes": [
    {
      "type": "modified",
      "path": "b",
      "oldValue": 2,
      "newValue": 3
    },
    {
      "type": "added",
      "path": "c",
      "value": 4
    }
  ],
  "summary": {
    "added": 1,
    "removed": 0,
    "modified": 1,
    "unchanged": 1
  }
}
```

### Text Diff

```json
{
  "diff": [
    {
      "type": "unchanged",
      "line": "line1",
      "oldLineNo": 1,
      "newLineNo": 1
    },
    {
      "type": "removed",
      "line": "line2",
      "oldLineNo": 2
    },
    {
      "type": "added",
      "line": "line3",
      "newLineNo": 2
    }
  ]
}
```

## Use Cases

- Configuration change tracking
- API response comparison
- Version control integration
- Audit logging
- Data synchronization validation

## License

MIT
