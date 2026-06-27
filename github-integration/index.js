/**
 * @maitask/github-integration
 * GitHub REST API integration for repositories, issues, pull requests, users,
 * and custom REST calls.
 *
 * @version 0.2.0
 * @author Maitask Team
 * @license MIT
 */

const PACKAGE_NAME = '@maitask/github-integration';
const PACKAGE_VERSION = '0.2.0';

async function execute(input = {}, options = {}, context = {}) {
    const startedAt = Date.now();
    let config;

    try {
        ensureFetch('github-integration');
        config = buildConfig(input, options, context);

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
            case 'list-pulls':
                result = await listPulls(config);
                break;
            case 'get-pull':
                result = await getPull(config);
                break;
            case 'create-pull':
                result = await createPull(config);
                break;
            case 'get-user':
                result = await getUser(config);
                break;
            case 'request':
                result = await customRequest(config);
                break;
            default:
                throw validationError(`Unknown action: ${config.action}`);
        }

        return buildSuccessResponse(result, config, context, startedAt);
    } catch (error) {
        return {
            success: false,
            data: {
                items: [],
                summary: {
                    total: 0,
                    success_count: 0,
                    failure_count: 1
                }
            },
            error: {
                message: error.message || 'GitHub API request failed',
                code: error.code || 'GITHUB_INTEGRATION_ERROR',
                type: error.type || error.name || 'GitHubIntegrationError',
                status: error.status || null,
                details: error.details || null
            },
            metadata: {
                contract_version: '2026-06-27',
                package: PACKAGE_NAME,
                version: PACKAGE_VERSION,
                execution_id: context?.execution_id || null,
                provider: 'github',
                action: config?.action || input?.action || options?.action || 'list-repos',
                operation: config?.operation || input?.operation || options?.operation || null,
                executed_at: new Date().toISOString(),
                execution_ms: Date.now() - startedAt,
                rate_limit: error.rateLimit || null
            },
            citations: []
        };
    }
}

if (typeof module !== "undefined") {
  module.exports = { execute };
}
execute;

function buildSuccessResponse(result, config, context, startedAt) {
    const rawItems = Array.isArray(result?.items)
        ? result.items
        : result?.item == null
            ? []
            : [result.item];
    const items = rawItems.map((item, index) => ({
        index,
        id: item?.id == null ? undefined : String(item.id),
        data: item
    }));
    const summary = result?.summary && typeof result.summary === 'object'
        ? {
            total: Number(result.summary.total ?? items.length),
            success_count: Number(result.summary.success_count ?? items.length),
            failure_count: Number(result.summary.failure_count ?? 0)
        }
        : {
            total: items.length,
            success_count: items.length,
            failure_count: 0
        };

    return {
        success: true,
        data: {
            items,
            summary
        },
        error: null,
        metadata: {
            contract_version: '2026-06-27',
            package: PACKAGE_NAME,
            version: PACKAGE_VERSION,
            execution_id: context?.execution_id || null,
            provider: 'github',
            action: config.action,
            operation: config.operation,
            executed_at: new Date().toISOString(),
            execution_ms: Date.now() - startedAt,
            rate_limit: result?.rateLimit || null
        },
        citations: []
    };
}

function buildConfig(input, options, context) {
    const source = mergeObjects(options || {}, input || {});
    const operation = source.operation || source.action || 'list-repos';
    const action = normalizeAction(operation);

    return {
        token: resolveToken(source, context),
        action,
        operation,
        baseUrl: normalizeBaseUrl(source.baseUrl || source.base_url || 'https://api.github.com'),
        timeoutMs: readPositiveInt(source.timeoutMs || source.timeout, 30000, 1, 120000),
        owner: source.owner || source.org || source.organization,
        ownerType: source.ownerType || source.owner_type || source.scope,
        type: source.type,
        repo: source.repo || source.repository,
        username: source.username || source.user || source.owner,
        per_page: readPositiveInt(source.per_page || source.perPage || source.limit, 30, 1, 100),
        page: readPositiveInt(source.page, 1, 1, 100000),
        state: source.state || 'open',
        sort: source.sort || 'updated',
        direction: source.direction || 'desc',
        labels: normalizeList(source.labels),
        assignees: normalizeList(source.assignees),
        assignee: source.assignee,
        mentioned: source.mentioned,
        milestone: source.milestone,
        title: source.title,
        body: source.body,
        issueNumber: source.issueNumber || source.issue_number || source.number,
        pullNumber: source.pullNumber || source.pull_number || source.number,
        head: source.head,
        base: source.base,
        draft: source.draft === true,
        method: source.method,
        path: source.path || source.endpoint || source.url,
        query: source.query || source.params,
        json: source.json,
        requestBody: source.requestBody ?? source.data ?? source.payload ?? source.body,
        headers: source.headers || {}
    };
}

function normalizeAction(value) {
    const action = String(value || 'list-repos').trim();
    const normalized = action.replace(/_/g, '-').toLowerCase();
    const aliases = {
        'repos.list': 'list-repos',
        'repositories.list': 'list-repos',
        'listrepos': 'list-repos',
        'repo.list': 'list-repos',
        'repos.get': 'get-repo',
        'repositories.get': 'get-repo',
        'getrepo': 'get-repo',
        'repo.get': 'get-repo',
        'issues.list': 'list-issues',
        'issue.list': 'list-issues',
        'listissues': 'list-issues',
        'issues.create': 'create-issue',
        'issue.create': 'create-issue',
        'createissue': 'create-issue',
        'pulls.list': 'list-pulls',
        'pull-requests.list': 'list-pulls',
        'prs.list': 'list-pulls',
        'pulls.get': 'get-pull',
        'pull-requests.get': 'get-pull',
        'prs.get': 'get-pull',
        'pulls.create': 'create-pull',
        'pull-requests.create': 'create-pull',
        'prs.create': 'create-pull',
        'users.get': 'get-user',
        'user.get': 'get-user',
        'getuser': 'get-user',
        'rest.request': 'request',
        'api.request': 'request',
        'custom.request': 'request'
    };
    return aliases[normalized] || normalized;
}

async function listRepositories(config) {
    const endpoint = buildRepositoriesEndpoint(config);
    const response = await githubRequest('GET', endpoint, config, {
        requiresAuth: !config.owner,
        query: {
            per_page: config.per_page,
            page: config.page,
            sort: config.sort,
            direction: config.direction,
            type: config.type
        }
    });

    const repositories = ensureArray(response.data).map(mapRepository);
    return withCollection({
        repositories,
        total: repositories.length,
        rateLimit: response.rateLimit
    }, repositories);
}

function buildRepositoriesEndpoint(config) {
    if (!config.owner) return '/user/repos';
    if (String(config.ownerType || '').toLowerCase() === 'org') {
        return `/orgs/${encodeURIComponent(config.owner)}/repos`;
    }
    return `/users/${encodeURIComponent(config.owner)}/repos`;
}

async function getRepository(config) {
    requireOwnerRepo(config, 'get-repo');

    const response = await githubRequest(
        'GET',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
        config
    );

    const repository = mapRepository(response.data);
    return withSingle({
        repository,
        rateLimit: response.rateLimit
    }, repository);
}

async function listIssues(config) {
    requireOwnerRepo(config, 'list-issues');

    const response = await githubRequest(
        'GET',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
        config,
        {
            query: compactObject({
                per_page: config.per_page,
                page: config.page,
                state: config.state,
                sort: config.sort,
                direction: config.direction,
                labels: config.labels.length ? config.labels.join(',') : undefined,
                assignee: config.assignee,
                mentioned: config.mentioned,
                milestone: config.milestone
            })
        }
    );

    const issues = ensureArray(response.data)
        .filter(item => !item.pull_request)
        .map(mapIssue);
    return withCollection({
        issues,
        total: issues.length,
        rateLimit: response.rateLimit
    }, issues);
}

async function createIssue(config) {
    requireToken(config, 'create-issue');
    requireOwnerRepo(config, 'create-issue');
    if (!config.title) {
        throw validationError('Issue title is required for create-issue action');
    }

    const payload = compactObject({
        title: config.title,
        body: config.body || '',
        labels: config.labels,
        assignees: config.assignees,
        milestone: config.milestone
    });

    const response = await githubRequest(
        'POST',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
        config,
        { json: payload, requiresAuth: true }
    );

    const issue = mapIssue(response.data);
    return withSingle({
        issue,
        rateLimit: response.rateLimit
    }, issue);
}

async function listPulls(config) {
    requireOwnerRepo(config, 'list-pulls');

    const response = await githubRequest(
        'GET',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls`,
        config,
        {
            query: compactObject({
                per_page: config.per_page,
                page: config.page,
                state: config.state,
                sort: config.sort,
                direction: config.direction,
                head: config.head,
                base: config.base
            })
        }
    );

    const pulls = ensureArray(response.data).map(mapPull);
    return withCollection({
        pulls,
        total: pulls.length,
        rateLimit: response.rateLimit
    }, pulls);
}

async function getPull(config) {
    requireOwnerRepo(config, 'get-pull');
    const number = readRequiredString(config.pullNumber, 'pullNumber');

    const response = await githubRequest(
        'GET',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls/${encodeURIComponent(number)}`,
        config
    );

    const pull = mapPull(response.data);
    return withSingle({
        pull,
        rateLimit: response.rateLimit
    }, pull);
}

async function createPull(config) {
    requireToken(config, 'create-pull');
    requireOwnerRepo(config, 'create-pull');
    const title = readRequiredString(config.title, 'title');
    const head = readRequiredString(config.head, 'head');
    const base = readRequiredString(config.base, 'base');

    const response = await githubRequest(
        'POST',
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls`,
        config,
        {
            requiresAuth: true,
            json: compactObject({
                title,
                head,
                base,
                body: config.body || '',
                draft: config.draft
            })
        }
    );

    const pull = mapPull(response.data);
    return withSingle({
        pull,
        rateLimit: response.rateLimit
    }, pull);
}

async function getUser(config) {
    const endpoint = config.username
        ? `/users/${encodeURIComponent(config.username)}`
        : '/user';

    const response = await githubRequest('GET', endpoint, config, {
        requiresAuth: endpoint === '/user'
    });

    const user = mapUser(response.data);
    return withSingle({
        user,
        rateLimit: response.rateLimit
    }, user);
}

async function customRequest(config) {
    const method = normalizeMethod(config.method || 'GET');
    const path = readRequiredString(config.path, 'path');
    const body = config.json !== undefined ? config.json : config.requestBody;

    const response = await githubRequest(method, path, config, {
        query: config.query,
        headers: config.headers,
        json: body,
        requiresAuth: method !== 'GET' && method !== 'HEAD'
    });

    const data = response.data;
    const items = Array.isArray(data) ? data : (data == null ? [] : [data]);
    return {
        response: data,
        items,
        summary: {
            total: items.length,
            success_count: 1,
            failure_count: 0
        },
        rateLimit: response.rateLimit,
        request: {
            method,
            url: response.url
        }
    };
}

async function githubRequest(method, endpoint, config, requestOptions = {}) {
    if (requestOptions.requiresAuth) {
        requireToken(config, `${method} ${endpoint}`);
    }

    const url = buildRequestUrl(endpoint, config.baseUrl, requestOptions.query);
    const headers = buildRequestHeaders(config, requestOptions.headers);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    const fetchOptions = {
        method,
        headers,
        signal: controller.signal
    };

    if (requestOptions.json !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = JSON.stringify(requestOptions.json);
        fetchOptions.headers['Content-Type'] = 'application/json';
    } else if (requestOptions.body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = requestOptions.body;
    }

    let response;
    try {
        response = await fetch(url, fetchOptions);
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeout = new Error(`GitHub API request timed out after ${config.timeoutMs}ms`);
            timeout.code = 'GITHUB_TIMEOUT';
            timeout.type = 'TimeoutError';
            throw timeout;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }

    const text = await response.text();
    const data = parseJsonOrText(text);
    const rateLimit = extractRateLimit(response);

    if (!response.ok) {
        const message = data && typeof data === 'object' && data.message
            ? data.message
            : text || response.statusText;
        const error = new Error(`GitHub API error: ${response.status} - ${message}`);
        error.code = 'GITHUB_API_ERROR';
        error.type = 'GitHubApiError';
        error.status = response.status;
        error.details = data;
        error.rateLimit = rateLimit;
        throw error;
    }

    return {
        data,
        rateLimit,
        url
    };
}

function buildRequestHeaders(config, extraHeaders) {
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Maitask-GitHub-Integration/0.2',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    if (config.token) {
        headers.Authorization = `Bearer ${config.token}`;
    }

    Object.assign(headers, normalizeHeaders(extraHeaders));
    return headers;
}

function buildRequestUrl(endpoint, baseUrl, query) {
    let url;
    if (/^https?:\/\//i.test(endpoint)) {
        url = new URL(endpoint);
    } else {
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        url = new URL(path, `${baseUrl}/`);
    }

    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value == null || value === '') continue;
            if (Array.isArray(value)) {
                value.forEach(item => url.searchParams.append(key, String(item)));
            } else {
                url.searchParams.set(key, String(value));
            }
        }
    }

    return url.toString();
}

function mapRepository(repo) {
    return {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        fork: repo.fork,
        archived: repo.archived,
        disabled: repo.disabled,
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
        license: repo.license ? {
            key: repo.license.key,
            name: repo.license.name,
            spdx_id: repo.license.spdx_id
        } : null,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at
    };
}

function mapIssue(issue) {
    return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        locked: issue.locked,
        user: issue.user ? mapActor(issue.user) : null,
        labels: ensureArray(issue.labels).map(label => ({
            id: label.id,
            name: label.name,
            color: label.color,
            description: label.description
        })),
        assignees: ensureArray(issue.assignees).map(mapActor),
        milestone: issue.milestone ? {
            number: issue.milestone.number,
            title: issue.milestone.title,
            state: issue.milestone.state,
            due_on: issue.milestone.due_on
        } : null,
        comments: issue.comments,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        html_url: issue.html_url
    };
}

function mapPull(pull) {
    return {
        id: pull.id,
        number: pull.number,
        title: pull.title,
        body: pull.body,
        state: pull.state,
        draft: pull.draft,
        merged: pull.merged,
        mergeable: pull.mergeable,
        user: pull.user ? mapActor(pull.user) : null,
        head: pull.head ? {
            ref: pull.head.ref,
            sha: pull.head.sha,
            label: pull.head.label,
            repo: pull.head.repo ? pull.head.repo.full_name : null
        } : null,
        base: pull.base ? {
            ref: pull.base.ref,
            sha: pull.base.sha,
            label: pull.base.label,
            repo: pull.base.repo ? pull.base.repo.full_name : null
        } : null,
        additions: pull.additions,
        deletions: pull.deletions,
        changed_files: pull.changed_files,
        commits: pull.commits,
        comments: pull.comments,
        review_comments: pull.review_comments,
        html_url: pull.html_url,
        created_at: pull.created_at,
        updated_at: pull.updated_at,
        closed_at: pull.closed_at,
        merged_at: pull.merged_at
    };
}

function mapUser(user) {
    return {
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
    };
}

function mapActor(actor) {
    return {
        login: actor.login,
        id: actor.id,
        avatar_url: actor.avatar_url,
        html_url: actor.html_url,
        type: actor.type
    };
}

function withCollection(result, items) {
    return Object.assign(result, {
        items,
        summary: {
            total: items.length,
            success_count: items.length,
            failure_count: 0
        }
    });
}

function withSingle(result, item) {
    return Object.assign(result, {
        items: item == null ? [] : [item],
        summary: {
            total: item == null ? 0 : 1,
            success_count: item == null ? 0 : 1,
            failure_count: 0
        }
    });
}

function requireOwnerRepo(config, action) {
    if (!config.owner || !config.repo) {
        throw validationError(`Both owner and repo are required for ${action} action`);
    }
}

function requireToken(config, action) {
    if (!config.token) {
        throw validationError(`GitHub token is required for ${action}. Set token, apiKey, or context.secrets.GITHUB_TOKEN.`);
    }
}

function resolveToken(source, context) {
    return source.token
        || source.apiKey
        || source.api_key
        || context?.secrets?.GITHUB_TOKEN
        || context?.secrets?.GH_TOKEN
        || context?.env?.GITHUB_TOKEN
        || null;
}

function extractRateLimit(response) {
    return {
        limit: parseInt(response.headers.get('x-ratelimit-limit') || '', 10) || null,
        remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '', 10) || null,
        reset: parseInt(response.headers.get('x-ratelimit-reset') || '', 10) || null,
        used: parseInt(response.headers.get('x-ratelimit-used') || '', 10) || null,
        resource: response.headers.get('x-ratelimit-resource') || null
    };
}

function parseJsonOrText(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (error) {
        return text;
    }
}

function normalizeMethod(value) {
    const method = String(value || 'GET').trim().toUpperCase();
    const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!allowed.includes(method)) {
        throw validationError(`Unsupported method '${value}'`);
    }
    return method;
}

function normalizeBaseUrl(value) {
    const text = readRequiredString(value, 'baseUrl').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(text)) {
        throw validationError('baseUrl must be an HTTP or HTTPS URL');
    }
    return text;
}

function normalizeHeaders(value) {
    if (!value) return {};
    if (!isPlainObject(value)) {
        throw validationError('headers must be an object');
    }
    const headers = {};
    for (const [key, item] of Object.entries(value)) {
        if (item == null) continue;
        headers[key] = String(item);
    }
    return headers;
}

function normalizeList(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function readRequiredString(value, key) {
    const text = value == null ? '' : String(value).trim();
    if (!text) throw validationError(`${key} is required`);
    return text;
}

function readPositiveInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const rounded = Math.floor(number);
    return Math.min(max, Math.max(min, rounded));
}

function compactObject(value) {
    const result = {};
    for (const [key, item] of Object.entries(value || {})) {
        if (item == null || item === '') continue;
        if (Array.isArray(item) && item.length === 0) continue;
        result[key] = item;
    }
    return result;
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(base, extra) {
    const result = {};
    Object.assign(result, base || {});
    Object.assign(result, extra || {});
    return result;
}

function validationError(message) {
    const error = new Error(message);
    error.code = 'VALIDATION_ERROR';
    error.type = 'ValidationError';
    return error;
}

function ensureFetch(packageName) {
    if (typeof fetch !== 'function') {
        throw validationError(`Global fetch API is unavailable. Please run @maitask/${packageName} on Node.js 18 or newer.`);
    }
}
