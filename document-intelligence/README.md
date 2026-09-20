# @maitask/document-intelligence

[English](README.md) | [中文](README_zh-CN.md)

Summarize, classify, or extract structured fields from documents. The package
calls an OpenAI-compatible Chat Completions endpoint, fails closed when the
model or credentials are missing, and returns sourced published copy.

## Tasks

- `summarize`: publishable title, body, and source list
- `classify`: label assignment against an explicit allowlist
- `extract`: JSON fields constrained by `options.schema`

## Options

| Field | Description |
| --- | --- |
| `task` | `summarize`, `classify`, or `extract` |
| `language` | `zh-CN` or `en` |
| `labels` | Required for `classify` |
| `schema` | Required for `extract` |
| `ai.apiKey` | Provider credential |
| `ai.baseUrl` | OpenAI-compatible base URL |
| `ai.model` | Model identifier |
| `output.includeSources` | Append source links to published copy |

There is no extractive fallback. Missing credentials, an empty model response,
or an unpublishable body return `success: false`.
