# @maitask/workflow-composer

[English](README.md) | [中文](README_zh-CN.md)

Generate a reviewable Maitask workflow graph from a natural-language
description and the official package catalog. Plane calls this package from
`POST /workflows/drafts`. The result is not a live workflow until a person
confirms and creates it.

## Contract

- Input includes `description`, `language`, and `catalog`.
- Output includes `name`, `description`, `nodes`, `edges`, `notes`, and `warnings`.
- Package names must come from the supplied catalog.
- Credentials, adapter identifiers, and webhook secrets are left empty.
- Missing credentials or an invalid graph return `success: false`.
