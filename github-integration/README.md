# @maitask/github-integration

GitHub REST API integration for repositories and users.

## Features

- List repositories for a user or organization
- Get detailed information about a specific repository
- List issues in a repository
- Create new issues
- Get user profile information
- GitHub API authentication support

## Configuration

### Required Options

- `token`: GitHub personal access token with required scopes

### Optional Options

- `action`: Action to perform ('list-repos', 'get-repo', 'list-issues', 'create-issue', 'get-user') - default: 'list-repos'
- `owner`: GitHub username or organization name (required for repo-specific actions)
- `repo`: Repository name (required for repo-specific actions)
- `username`: Username for user-specific actions (defaults to owner)
- `per_page`: Number of items per page (max 100) - default: 30
- `title`: Issue title (for create-issue action)
- `body`: Issue body (for create-issue action)
- `labels`: Issue labels (for create-issue action)

## Usage Examples

### List Repositories

```javascript
{
  "token": "your_github_token",
  "action": "list-repos",
  "owner": "octocat",
  "per_page": 20
}
```

### Get Repository Details

```javascript
{
  "token": "your_github_token",
  "action": "get-repo",
  "owner": "microsoft",
  "repo": "typescript"
}
```

### List Repository Issues

```javascript
{
  "token": "your_github_token",
  "action": "list-issues",
  "owner": "facebook",
  "repo": "react",
  "per_page": 15
}
```

### Create New Issue

```javascript
{
  "token": "your_github_token",
  "action": "create-issue",
  "owner": "octocat",
  "repo": "hello-world",
  "title": "New feature request",
  "body": "This is the issue description",
  "labels": ["bug", "feature-request"]
}
```

### Get User Information

```javascript
{
  "token": "your_github_token",
  "action": "get-user",
  "username": "octocat"
}
```

## Return Value

Success response structure varies by action:

### List Repositories Response

```javascript
{
  "success": true,
  "message": "GitHub list-repos completed successfully",
  "data": {
    "repositories": [
      {
        "id": 123,
        "name": "repo-name",
        "full_name": "owner/repo-name",
        "description": "Repository description",
        "private": true,
        "html_url": "https://github.com/owner/repo-name",
        "clone_url": "https://github.com/owner/repo-name.git",
        "ssh_url": "git@github.com:owner/repo-name.git",
        "language": "JavaScript",
        "forks_count": 5,
        "stargazers_count": 50,
        "watchers_count": 50,
        "size": 1000,
        "default_branch": "main",
        "open_issues_count": 3,
        "created_at": "2021-01-01T00:00:00Z",
        "updated_at": "2021-12-01T00:00:00Z",
        "pushed_at": "2021-11-30T00:00:00Z"
      }
    ],
    "total": 1
  },
  "metadata": {
    "action": "list-repos",
    "executedAt": "2025-01-27T10:30:00.000Z",
    "rateLimit": {
      "limit": 5000,
      "remaining": 4999,
      "reset": 1234567890,
      "used": 1
    }
  }
}
```

### Create Issue Response

```javascript
{
  "success": true,
  "message": "GitHub create-issue completed successfully",
  "data": {
    "issue": {
      "id": 123,
      "number": 1,
      "title": "New issue title",
      "body": "Issue body",
      "state": "open",
      "html_url": "https://github.com/owner/repo/issues/1",
      "created_at": "2025-01-27T10:30:00.000Z"
    }
  }
}
```

Error response:

```javascript
{
  "success": false,
  "message": "GitHub API error: error message",
  "error": "error details"
}
```
