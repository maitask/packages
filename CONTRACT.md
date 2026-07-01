# Maitask Package IO Contract

Contract version: `2026-06-27`

Every package exposes one async-compatible entry point:

```js
execute(input, options, context)
```

The function must return a JSON-serializable value. Runtime canonicalizes that
value into `PackageExecutionResult` before it reaches Plane, adapters, or the
frontend.

## Input

`input` is the task payload. It may be any JSON value, but each package must validate the shape it supports and return a structured error when invalid.

`options` is execution configuration. Packages should keep operational settings here, such as `timeout_ms`, `retries`, `format`, `headers`, or provider-specific flags.

`context` is runtime-provided execution context. Packages may read secrets and environment values from:

```json
{
  "secrets": {},
  "env": {},
  "workspace_path": "...",
  "execution_id": "...",
  "user_id": "..."
}
```

Packages must not mutate `input`, `options`, or `context`.

## Examples

Every package must publish `example.json` in the package tarball. When
`package.json` defines a `files` array, it must include `example.json`.

The canonical single-example shape is:

```json
{
  "name": "Optional example name",
  "description": "Optional markdown description",
  "input": {},
  "options": {},
  "context": {},
  "expected_output": {}
}
```

Packages with multiple examples must use:

```json
{
  "examples": [
    {
      "name": "Small input",
      "input": {},
      "options": {}
    }
  ]
}
```

If `example.json` contains any other JSON value, Plane treats the entire value
as the package `input`. `options` and `context`, when present, must be JSON
objects. Plane exposes normalized examples through the package descriptor API,
and frontend surfaces consume only that normalized `examples` field.

## Output

All package executions are exposed at the Runtime boundary with this top-level
shape:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "index": 0,
        "id": "optional-stable-id",
        "data": {},
        "metadata": {},
        "citation_ids": []
      }
    ],
    "summary": {
      "total": 1,
      "success_count": 1,
      "failure_count": 0,
      "metrics": {}
    }
  },
  "error": null,
  "metadata": {
    "contract_version": "2026-06-27",
    "package": "@maitask/package-name",
    "version": "1.0.0",
    "execution_id": "runtime-execution-id",
    "execution_ms": 42,
    "timestamp": "2026-06-27T10:00:00.000Z"
  },
  "citations": []
}
```

Failure output:

```json
{
  "success": false,
  "data": {
    "items": [],
    "summary": {
      "total": 0,
      "success_count": 0,
      "failure_count": 1
    }
  },
  "error": {
    "message": "Human-readable message",
    "code": "PACKAGE_ERROR_CODE",
    "type": "PackageErrorType",
    "details": {}
  },
  "metadata": {
    "contract_version": "2026-06-27",
    "package": "@maitask/package-name",
    "version": "1.0.0",
    "execution_id": "runtime-execution-id",
    "execution_ms": 42,
    "timestamp": "2026-06-27T10:00:00.000Z"
  },
  "citations": []
}
```

## Rules

- Top-level keys are fixed: `success`, `data`, `error`, `metadata`, `citations`.
- Successful executions set `error` to `null`.
- Failed executions set `success` to `false` and include `error.message`, `error.code`, and `error.type`.
- `data.items` is always an array. Single-result packages return one item.
- Each item stores the actual payload in `item.data`.
- Package-specific statistics belong in `data.summary.metrics`.
- Package-specific per-item diagnostics belong in `item.metadata`.
- Execution and delivery metadata belongs in top-level `metadata`.
- Source references belong in top-level `citations`, and items may point to them through `citation_ids`.
- Public consumers must not depend on package-specific top-level aliases such as `result`, `rows`, `repositories`, `message`, `parser`, or `statistics`.
- Runtime enforces this contract at the execution boundary. Plane, adapters, and the frontend consume only the standard output.

## Runtime HTTP Execute Response

Runtime wraps the package output with execution metadata:

```json
{
  "success": true,
  "data": {
    "execution": {
      "id": "runtime-execution-id",
      "status": "completed",
      "duration_ms": 42,
      "credits_consumed": null,
      "load_balanced": false,
      "timestamp": "2026-06-27T10:00:00.000Z"
    },
    "output": {
      "success": true,
      "data": {
        "items": [],
        "summary": {
          "total": 0,
          "success_count": 0,
          "failure_count": 0
        }
      },
      "error": null,
      "metadata": {},
      "citations": []
    }
  },
  "timestamp": "2026-06-27T10:00:00.000Z"
}
```
