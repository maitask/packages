# @maitask/github-integration

GitHub REST API integration for repositories, issues, pull requests, users, and custom API calls.

## Features

- List repositories for a user, organization, or authenticated account.
- Get repository details.
- List and create issues.
- List, get, and create pull requests.
- Get public or authenticated user profiles.
- Execute custom GitHub REST API calls with `method`, `path`, `query`, and `json` body.
- Supports public GET calls without a token and authenticated writes with a token.
- Supports GitHub Enterprise through `baseUrl`.
- Provides rate-limit metadata that Runtime exposes through standardized `items` and `summary` output.

## Authentication

Read-only public calls can run without a token. Authenticated calls use one of:

- `token`
- `apiKey` / `api_key`
- `context.secrets.GITHUB_TOKEN`
- `context.secrets.GH_TOKEN`
- `context.env.GITHUB_TOKEN`

## Actions

Action names:

- `list-repos`
- `get-repo`
- `list-issues`
- `create-issue`
- `get-user`

Additional actions:

- `list-pulls`
- `get-pull`
- `create-pull`
- `request`

Dot-notation aliases are also supported:

- `repos.list`
- `repos.get`
- `issues.list`
- `issues.create`
- `pulls.list`
- `pulls.get`
- `pulls.create`
- `users.get`
- `rest.request`

## Examples

### List Public Repositories

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "repos.list",
    "owner": "octocat",
    "per_page": 20
  }
}
```

### Get Repository Details

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "repos.get",
    "owner": "microsoft",
    "repo": "typescript"
  }
}
```

### List Issues

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "issues.list",
    "owner": "facebook",
    "repo": "react",
    "state": "open",
    "labels": ["bug"],
    "per_page": 15
  }
}
```

### Create Issue

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "issues.create",
    "token": "$GITHUB_TOKEN",
    "owner": "octocat",
    "repo": "hello-world",
    "title": "New feature request",
    "body": "This is the issue description",
    "labels": ["feature-request"]
  }
}
```

### Create Pull Request

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "pulls.create",
    "token": "$GITHUB_TOKEN",
    "owner": "octocat",
    "repo": "hello-world",
    "title": "Merge feature branch",
    "head": "feature-branch",
    "base": "main",
    "body": "Ready for review"
  }
}
```

### Custom REST Request

```json
{
  "package": "@maitask/github-integration",
  "input": {
    "operation": "rest.request",
    "token": "$GITHUB_TOKEN",
    "method": "GET",
    "path": "/repos/owner/repo/actions/runs",
    "query": {
      "per_page": 10
    }
  }
}
```

## Common Options

- `baseUrl`: GitHub API base URL. Default: `https://api.github.com`.
- `timeoutMs` / `timeout`: Request timeout in milliseconds. Default: `30000`.
- `owner`: Repository owner or organization.
- `repo`: Repository name.
- `per_page` / `perPage` / `limit`: Page size, max `100`.
- `page`: Page number.
- `state`: Issue or pull state.
- `sort`: Sort field.
- `direction`: Sort direction.

## Response Contract

Action-specific fields remain available, and every successful response also includes `items` and `summary`.

```json
{
  "success": true,
  "data": {
    "repositories": [],
    "total": 0,
    "rateLimit": {
      "limit": 60,
      "remaining": 59,
      "reset": 1234567890,
      "used": 1,
      "resource": "core"
    },
    "items": [],
    "summary": {
      "total": 0,
      "successCount": 0,
      "failureCount": 0
    }
  },
  "metadata": {
    "package": "@maitask/github-integration",
    "version": "0.2.0",
    "provider": "github",
    "action": "list-repos",
    "operation": "repos.list",
    "executionMs": 42,
    "rateLimit": {}
  }
}
```

Failures use `{ success: false, error: { message, code, type, status, details }, metadata }`.
