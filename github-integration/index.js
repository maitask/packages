/**
 * @maitask/github-integration
 * GitHub API integration for repositories and users
 *
 * Features:
 * - Repository listing and details
 * - Issue management (list, create)
 * - User information retrieval
 * - Rate limit tracking
 * - Comprehensive error handling
 *
 * @version 0.1.0
 * @author Maitask Team
 * @license MIT
 */

/**
 * Main execution function for GitHub operations
 * @param {Object} input - GitHub operation configuration
 * @param {Object} options - Operation options and authentication
 * @param {Object} context - Execution context with secrets
 * @returns {Object} GitHub operation result with rate limit info
 */
async function execute(input, options, context) {
    console.log('GitHub Integration - Starting');

    ensureFetch('github-integration');

    const config = buildConfig(input, options, context);

    if (!config.token) {
        throw new Error('GitHub token is required. Set token in options or input.');
    }

    try {
        let result;

        switch (config.action) {
            case 'list-repos':
                result = await listRepositories(config);
                break;
            case 'get-repo':
                result = await getRepository(config);
                break;
            case 'list-issues':
                result = await listIssues(config);
                break;
            case 'create-issue':
                result = await createIssue(config);
                break;
            case 'get-user':
                result = await getUser(config);
                break;
            default:
                throw new Error(`Unknown action: ${config.action}`);
        }

        return {
            success: true,
            message: `GitHub ${config.action} completed successfully`,
            data: result,
            metadata: {
                action: config.action,
                executedAt: new Date().toISOString(),
                rateLimit: result.rateLimit || null
            }
        };

    } catch (error) {
        return {
            success: false,
            message: `GitHub API error: ${error.message}`,
            error: error.toString(),
            action: config.action
        };
    }
}

function buildConfig(input, options, context) {
    const source = mergeObjects(options || {}, input || {});

    return {
        token: source.token || context?.secrets?.GITHUB_TOKEN,
        action: source.action || 'list-repos',
        owner: source.owner,
        repo: source.repo,
        username: source.username || source.owner,
        per_page: Math.min(source.per_page || 30, 100),
        title: source.title,
        body: source.body,
        labels: source.labels || []
    };
}

async function listRepositories(config) {
    const endpoint = config.owner
        ? `https://api.github.com/users/${config.owner}/repos`
        : 'https://api.github.com/user/repos';

    const response = await githubRequest('GET', endpoint, config, {
        query: {
            per_page: config.per_page,
            sort: 'updated',
            direction: 'desc'
        }
    });

    return {
        repositories: response.data.map(repo => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            private: repo.private,
            html_url: repo.html_url,
            clone_url: repo.clone_url,
            ssh_url: repo.ssh_url,
            language: repo.language,
            forks_count: repo.forks_count,
            stargazers_count: repo.stargazers_count,
            watchers_count: repo.watchers_count,
            size: repo.size,
            default_branch: repo.default_branch,
            open_issues_count: repo.open_issues_count,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            pushed_at: repo.pushed_at
        })),
        total: response.data.length,
        rateLimit: response.rateLimit
    };
}

async function getRepository(config) {
    if (!config.owner || !config.repo) {
        throw new Error('Both owner and repo are required for get-repo action');
    }

    const endpoint = `https://api.github.com/repos/${config.owner}/${config.repo}`;
    const response = await githubRequest('GET', endpoint, config);

    const repo = response.data;
    return {
        repository: {
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            private: repo.private,
            html_url: repo.html_url,
            clone_url: repo.clone_url,
            ssh_url: repo.ssh_url,
            language: repo.language,
            forks_count: repo.forks_count,
            stargazers_count: repo.stargazers_count,
            watchers_count: repo.watchers_count,
            size: repo.size,
            default_branch: repo.default_branch,
            open_issues_count: repo.open_issues_count,
            topics: repo.topics || [],
            license: repo.license ? repo.license.name : null,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            pushed_at: repo.pushed_at
        },
        rateLimit: response.rateLimit
    };
}

async function listIssues(config) {
    if (!config.owner || !config.repo) {
        throw new Error('Both owner and repo are required for list-issues action');
    }

    const endpoint = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;
    const response = await githubRequest('GET', endpoint, config, {
        query: {
            per_page: config.per_page,
            state: 'open',
            sort: 'updated',
            direction: 'desc'
        }
    });

    return {
        issues: response.data.map(issue => ({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            user: {
                login: issue.user.login,
                id: issue.user.id,
                avatar_url: issue.user.avatar_url
            },
            labels: issue.labels.map(label => ({
                name: label.name,
                color: label.color,
                description: label.description
            })),
            assignees: issue.assignees.map(assignee => assignee.login),
            milestone: issue.milestone ? issue.milestone.title : null,
            comments: issue.comments,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            html_url: issue.html_url
        })),
        total: response.data.length,
        rateLimit: response.rateLimit
    };
}

async function createIssue(config) {
    if (!config.owner || !config.repo) {
        throw new Error('Both owner and repo are required for create-issue action');
    }
    if (!config.title) {
        throw new Error('Issue title is required for create-issue action');
    }

    const endpoint = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;
    const payload = {
        title: config.title,
        body: config.body || '',
        labels: config.labels || []
    };

    const response = await githubRequest('POST', endpoint, config, { json: payload });

    const issue = response.data;
    return {
        issue: {
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            html_url: issue.html_url,
            created_at: issue.created_at
        },
        rateLimit: response.rateLimit
    };
}

async function getUser(config) {
    const endpoint = config.username
        ? `https://api.github.com/users/${config.username}`
        : 'https://api.github.com/user';

    const response = await githubRequest('GET', endpoint, config);

    const user = response.data;
    return {
        user: {
            id: user.id,
            login: user.login,
            name: user.name,
            email: user.email,
            bio: user.bio,
            company: user.company,
            location: user.location,
            blog: user.blog,
            twitter_username: user.twitter_username,
            public_repos: user.public_repos,
            public_gists: user.public_gists,
            followers: user.followers,
            following: user.following,
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            created_at: user.created_at,
            updated_at: user.updated_at
        },
        rateLimit: response.rateLimit
    };
}

async function githubRequest(method, url, config, requestOptions = {}) {
    const headers = {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Maitask-GitHub-Integration/1.0'
    };

    if (requestOptions.headers) {
        Object.assign(headers, requestOptions.headers);
    }

    let requestUrl = url;
    if (requestOptions.query && Object.keys(requestOptions.query).length > 0) {
        const params = new URLSearchParams();
        Object.entries(requestOptions.query).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                params.append(key, String(value));
            }
        });
        requestUrl += `?${params.toString()}`;
    }

    const fetchOptions = {
        method,
        headers
    };

    if (requestOptions.json !== undefined) {
        fetchOptions.body = JSON.stringify(requestOptions.json);
        fetchOptions.headers['Content-Type'] = 'application/json';
    } else if (requestOptions.body !== undefined) {
        fetchOptions.body = requestOptions.body;
    }

    const response = await fetch(requestUrl, fetchOptions);
    const text = await response.text();
    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = text;
        }
    }

    if (!response.ok) {
        const message = typeof data === 'object' && data !== null && data.message
            ? data.message
            : text || response.statusText;
        throw new Error(`GitHub API error: ${response.status} - ${message}`);
    }

    const rateLimit = {
        limit: parseInt(response.headers.get('x-ratelimit-limit') || '') || null,
        remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '') || null,
        reset: parseInt(response.headers.get('x-ratelimit-reset') || '') || null,
        used: parseInt(response.headers.get('x-ratelimit-used') || '') || null
    };

    return {
        data: data,
        rateLimit: rateLimit
    };
}

function mergeObjects(base, extra) {
    const result = {};
    Object.assign(result, base || {});
    Object.assign(result, extra || {});
    return result;
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw new Error(`Global fetch API is unavailable. Please run @maitask/${packageName} on Node.js 18 or newer.`);
    }
}

execute;
