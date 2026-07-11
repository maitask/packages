/**
 * @maitask/github-integration
 * Credential-confined GitHub REST API client.
 */

const PACKAGE_NAME = '@maitask/github-integration';
const PACKAGE_VERSION = '1.0.0';
const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const ACTION_FIELDS = Object.freeze({
  listRepositories: new Set([
    'action', 'owner', 'ownerType', 'repositoryType', 'perPage', 'page', 'sort', 'direction'
  ]),
  getRepository: new Set(['action', 'owner', 'repository']),
  listIssues: new Set([
    'action', 'owner', 'repository', 'perPage', 'page', 'state', 'sort', 'direction',
    'labels', 'assignee', 'mentioned', 'milestone'
  ]),
  createIssue: new Set([
    'action', 'owner', 'repository', 'title', 'body', 'labels', 'assignees', 'milestone'
  ]),
  listPullRequests: new Set([
    'action', 'owner', 'repository', 'perPage', 'page', 'state', 'sort', 'direction',
    'head', 'base'
  ]),
  getPullRequest: new Set(['action', 'owner', 'repository', 'pullNumber']),
  createPullRequest: new Set([
    'action', 'owner', 'repository', 'title', 'head', 'base', 'body', 'draft'
  ]),
  getUser: new Set(['action', 'username']),
  request: new Set(['action', 'method', 'path', 'query', 'body', 'headers', 'responseType'])
});
const OPTION_FIELDS = new Set([
  'baseUrl', 'token', 'timeoutMs', 'maxResponseBytes', 'allowInsecureHttp'
]);
const MANAGED_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'x-github-api-version'
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

class GitHubFailure extends Error {
  constructor(code, message, type, status, retriable, rateLimit) {
    super(message);
    this.code = code;
    this.type = type;
    this.status = status;
    this.retriable = retriable;
    this.rateLimit = rateLimit;
  }
}

async function execute(input = {}, options = {}, context = {}) {
  const startedAt = Date.now();
  let action = null;
  let executionId = null;
  try {
    ensureFetch();
    const config = buildConfig(input, options, context);
    action = config.action;
    executionId = config.executionId;
    const operation = await dispatch(config);
    return buildSuccess(operation, config, startedAt);
  } catch (error) {
    const failure = normalizeFailure(error);
    return {
      success: false,
      error: failure,
      metadata: {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        provider: 'github',
        action,
        executionId,
        rateLimit: error instanceof GitHubFailure ? error.rateLimit || null : null,
        executedAt: new Date().toISOString(),
        executionMs: Date.now() - startedAt
      },
      citations: []
    };
  }
}

async function dispatch(config) {
  switch (config.action) {
    case 'listRepositories':
      return listRepositories(config);
    case 'getRepository':
      return getRepository(config);
    case 'listIssues':
      return listIssues(config);
    case 'createIssue':
      return createIssue(config);
    case 'listPullRequests':
      return listPullRequests(config);
    case 'getPullRequest':
      return getPullRequest(config);
    case 'createPullRequest':
      return createPullRequest(config);
    case 'getUser':
      return getUser(config);
    case 'request':
      return customRequest(config);
    default:
      throw validationFailure();
  }
}

function buildConfig(rawInput, rawOptions, context) {
  const action = readAction(rawInput);
  const input = snapshotKnownRecord(rawInput, ACTION_FIELDS[action]);
  const options = snapshotKnownRecord(rawOptions, OPTION_FIELDS);
  const baseUrl = normalizeBaseUrl(
    optionalString(options.baseUrl, DEFAULT_BASE_URL),
    optionalBoolean(options.allowInsecureHttp, false)
  );
  const contextData = readContext(context);
  const token = optionalSecret(options.token, contextData.token);

  return {
    action,
    input,
    token,
    executionId: contextData.executionId,
    baseUrl,
    origin: new URL(baseUrl).origin,
    timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 120000),
    maxResponseBytes: boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1,
      20 * 1024 * 1024
    )
  };
}

function readAction(rawInput) {
  const record = inspectRecord(rawInput);
  const descriptor = record.descriptors.action;
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
    throw validationFailure();
  }
  const action = descriptor.value.trim();
  if (!Object.hasOwn(ACTION_FIELDS, action)) throw validationFailure();
  return action;
}

async function listRepositories(config) {
  const input = config.input;
  const owner = optionalIdentifier(input.owner);
  const ownerType = optionalEnum(input.ownerType, ['user', 'organization'], 'user');
  const endpoint = owner
    ? ownerType === 'organization'
      ? `orgs/${encodeURIComponent(owner)}/repos`
      : `users/${encodeURIComponent(owner)}/repos`
    : 'user/repos';
  if (!owner) requireToken(config);

  const response = await githubRequest(config, {
    method: 'GET',
    path: endpoint,
    query: {
      per_page: boundedInteger(input.perPage, 30, 1, 100),
      page: boundedInteger(input.page, 1, 1, 100000),
      sort: optionalEnum(input.sort, ['created', 'updated', 'pushed', 'full_name'], 'updated'),
      direction: optionalEnum(input.direction, ['asc', 'desc'], 'desc'),
      type: optionalEnum(
        input.repositoryType,
        ['all', 'owner', 'member', 'public', 'private', 'forks', 'sources'],
        undefined
      )
    }
  });
  const repositories = requireArray(response.body).map(mapRepository);
  return operationResult(repositories, response);
}

async function getRepository(config) {
  const owner = requiredIdentifier(config.input.owner);
  const repository = requiredIdentifier(config.input.repository);
  const response = await githubRequest(config, {
    method: 'GET',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
  });
  return operationResult([mapRepository(requireObject(response.body))], response);
}

async function listIssues(config) {
  const input = config.input;
  const owner = requiredIdentifier(input.owner);
  const repository = requiredIdentifier(input.repository);
  const response = await githubRequest(config, {
    method: 'GET',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues`,
    query: {
      per_page: boundedInteger(input.perPage, 30, 1, 100),
      page: boundedInteger(input.page, 1, 1, 100000),
      state: optionalEnum(input.state, ['open', 'closed', 'all'], 'open'),
      sort: optionalEnum(input.sort, ['created', 'updated', 'comments'], 'created'),
      direction: optionalEnum(input.direction, ['asc', 'desc'], 'desc'),
      labels: optionalStringArray(input.labels).join(',') || undefined,
      assignee: optionalIdentifier(input.assignee),
      mentioned: optionalIdentifier(input.mentioned),
      milestone: optionalInteger(input.milestone, 1, Number.MAX_SAFE_INTEGER)
    }
  });
  const issues = requireArray(response.body)
    .filter(item => !isObject(item) || !Object.hasOwn(item, 'pull_request'))
    .map(item => mapIssue(requireObject(item)));
  return operationResult(issues, response);
}

async function createIssue(config) {
  requireToken(config);
  const input = config.input;
  const owner = requiredIdentifier(input.owner);
  const repository = requiredIdentifier(input.repository);
  const body = compactObject({
    title: requiredText(input.title, 256),
    body: optionalText(input.body, 1024 * 1024),
    labels: optionalStringArray(input.labels),
    assignees: optionalStringArray(input.assignees),
    milestone: optionalInteger(input.milestone, 1, Number.MAX_SAFE_INTEGER)
  });
  const response = await githubRequest(config, {
    method: 'POST',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues`,
    body
  });
  return operationResult([mapIssue(requireObject(response.body))], response);
}

async function listPullRequests(config) {
  const input = config.input;
  const owner = requiredIdentifier(input.owner);
  const repository = requiredIdentifier(input.repository);
  const response = await githubRequest(config, {
    method: 'GET',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`,
    query: {
      per_page: boundedInteger(input.perPage, 30, 1, 100),
      page: boundedInteger(input.page, 1, 1, 100000),
      state: optionalEnum(input.state, ['open', 'closed', 'all'], 'open'),
      sort: optionalEnum(input.sort, ['created', 'updated', 'popularity', 'long-running'], 'created'),
      direction: optionalEnum(input.direction, ['asc', 'desc'], 'desc'),
      head: optionalText(input.head, 256),
      base: optionalText(input.base, 256)
    }
  });
  return operationResult(requireArray(response.body).map(item => mapPull(requireObject(item))), response);
}

async function getPullRequest(config) {
  const input = config.input;
  const owner = requiredIdentifier(input.owner);
  const repository = requiredIdentifier(input.repository);
  const pullNumber = requiredInteger(input.pullNumber, 1, Number.MAX_SAFE_INTEGER);
  const response = await githubRequest(config, {
    method: 'GET',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullNumber}`
  });
  return operationResult([mapPull(requireObject(response.body))], response);
}

async function createPullRequest(config) {
  requireToken(config);
  const input = config.input;
  const owner = requiredIdentifier(input.owner);
  const repository = requiredIdentifier(input.repository);
  const response = await githubRequest(config, {
    method: 'POST',
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`,
    body: compactObject({
      title: requiredText(input.title, 256),
      head: requiredText(input.head, 256),
      base: requiredText(input.base, 256),
      body: optionalText(input.body, 1024 * 1024),
      draft: optionalBoolean(input.draft, false)
    })
  });
  return operationResult([mapPull(requireObject(response.body))], response);
}

async function getUser(config) {
  const username = optionalIdentifier(config.input.username);
  if (!username) requireToken(config);
  const response = await githubRequest(config, {
    method: 'GET',
    path: username ? `users/${encodeURIComponent(username)}` : 'user'
  });
  return operationResult([mapUser(requireObject(response.body))], response);
}

async function customRequest(config) {
  const input = config.input;
  const method = normalizeMethod(input.method);
  if ((method === 'GET' || method === 'HEAD') && input.body !== undefined) {
    throw validationFailure();
  }
  if (method !== 'GET' && method !== 'HEAD') requireToken(config);
  const path = normalizeRelativePath(input.path);
  const responseType = optionalEnum(input.responseType, ['json', 'text'], 'json');
  const response = await githubRequest(config, {
    method,
    path,
    query: normalizeQuery(input.query),
    body: input.body === undefined ? undefined : snapshotJson(input.body),
    headers: normalizeHeaders(input.headers),
    responseType
  });
  const values = Array.isArray(response.body)
    ? response.body
    : response.body === null || response.body === ''
      ? []
      : [response.body];
  return operationResult(values, response);
}

async function githubRequest(config, request) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = buildRequestHeaders(config.token, request.headers, request.body !== undefined);
  let url = buildUrl(config.baseUrl, request.path, request.query);
  let redirects = 0;

  try {
    while (true) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw timeoutFailure();
      let response;
      try {
        response = await fetch(url.href, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          redirect: 'manual',
          signal: controller.signal,
          timeoutMs: remainingMs,
          maxResponseBytes: config.maxResponseBytes
        });
      } catch {
        if (controller.signal.aborted || Date.now() >= deadlineAt) throw timeoutFailure();
        throw upstreamFailure();
      }

      if (isRedirectStatus(response.status)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') throw redirectFailure();
        if (redirects >= MAX_REDIRECTS) throw redirectFailure();
        const location = response.headers.get('location');
        if (!location) throw redirectFailure();
        let next;
        try {
          next = new URL(location, url);
        } catch {
          throw redirectFailure();
        }
        if (next.origin !== config.origin || next.username || next.password || next.hash) {
          throw redirectFailure();
        }
        if (response.body && typeof response.body.cancel === 'function') {
          await response.body.cancel().catch(() => {});
        }
        url = next;
        redirects += 1;
        continue;
      }

      const bytes = await readResponseBytes(response, config.maxResponseBytes, controller);
      const rateLimit = extractRateLimit(response.headers);
      if (!response.ok) {
        throw apiFailure(response.status, rateLimit);
      }
      const body = parseResponseBody(bytes, request.responseType || 'json', response.status);
      return { body, rateLimit, status: response.status, redirects };
    }
  } catch (error) {
    if (error instanceof GitHubFailure) throw error;
    if (controller.signal.aborted || Date.now() >= deadlineAt) throw timeoutFailure();
    throw upstreamFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBytes(response, maxResponseBytes, controller) {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxResponseBytes) {
      controller.abort();
      throw responseTooLargeFailure();
    }
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxResponseBytes) {
          controller.abort();
          throw responseTooLargeFailure();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxResponseBytes) throw responseTooLargeFailure();
  return bytes;
}

function parseResponseBody(bytes, responseType, status) {
  if (status === 204 || bytes.byteLength === 0) return null;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (responseType === 'text') return text;
  try {
    return JSON.parse(text);
  } catch {
    throw upstreamFailure();
  }
}

function buildRequestHeaders(token, extraHeaders, hasBody) {
  const extra = normalizeHeaders(extraHeaders);
  const accept = extra.accept || 'application/vnd.github+json';
  delete extra.accept;
  const headers = {
    ...extra,
    Accept: accept,
    'User-Agent': 'Maitask-GitHub-Integration/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildUrl(baseUrl, path, query) {
  const relativePath = normalizeRelativePath(path);
  const base = new URL(baseUrl);
  const prefix = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
  base.pathname = `${prefix}/${relativePath.replace(/^\/+/, '')}`;
  base.search = '';
  base.hash = '';
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) base.searchParams.append(key, String(item));
      } else {
        base.searchParams.set(key, String(value));
      }
    }
  }
  return base;
}

function normalizeBaseUrl(value, allowInsecureHttp) {
  let parsed;
  try {
    parsed = new URL(requiredText(value, 2048));
  } catch {
    throw validationFailure();
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw validationFailure();
  if (parsed.protocol === 'http:') {
    if (!allowInsecureHttp || !isPrivateOrLocalHost(parsed.hostname)) throw policyFailure();
  } else if (parsed.protocol !== 'https:') {
    throw validationFailure();
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.href.replace(/\/$/, parsed.pathname === '/' ? '' : '');
}

function normalizeRelativePath(value) {
  const path = requiredText(value, 4096);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\') || path.includes('\0')) {
    throw validationFailure();
  }
  const normalized = path.replace(/^\/+/, '');
  if (!normalized || normalized.includes('//')) throw validationFailure();
  for (const segment of normalized.split('/')) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw validationFailure();
    }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw validationFailure();
    }
  }
  return normalized;
}

function normalizeMethod(value) {
  const method = requiredText(value, 16).toUpperCase();
  if (!HTTP_METHODS.has(method)) throw validationFailure();
  return method;
}

function normalizeHeaders(value) {
  if (value === undefined) return {};
  const record = snapshotOpenRecord(value);
  const headers = Object.create(null);
  const seen = new Set();
  for (const [name, rawValue] of Object.entries(record)) {
    if (!HEADER_NAME_PATTERN.test(name) || typeof rawValue !== 'string' || /[\r\n]/.test(rawValue)) {
      throw validationFailure();
    }
    const lower = name.toLowerCase();
    if (MANAGED_HEADERS.has(lower) || seen.has(lower)) throw validationFailure();
    seen.add(lower);
    headers[lower] = rawValue;
  }
  return headers;
}

function normalizeQuery(value) {
  if (value === undefined) return undefined;
  const record = snapshotOpenRecord(value);
  const result = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (!key || key.length > 256) throw validationFailure();
    if (Array.isArray(item)) {
      result[key] = snapshotPrimitiveArray(item);
    } else if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      if (typeof item === 'number' && !Number.isFinite(item)) throw validationFailure();
      result[key] = item;
    } else {
      throw validationFailure();
    }
  }
  return result;
}

function operationResult(values, response) {
  return {
    values,
    rateLimit: response.rateLimit,
    status: response.status,
    redirects: response.redirects
  };
}

function buildSuccess(operation, config, startedAt) {
  const items = operation.values.map((value, index) => ({
    index,
    ...(value && typeof value === 'object' && value.id !== undefined && value.id !== null
      ? { id: String(value.id) }
      : {}),
    data: value
  }));
  return {
    success: true,
    data: {
      items,
      summary: {
        total: items.length,
        success_count: items.length,
        failure_count: 0
      }
    },
    error: null,
    metadata: {
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      provider: 'github',
      action: config.action,
      executionId: config.executionId,
      status: operation.status,
      redirects: operation.redirects,
      rateLimit: operation.rateLimit,
      executedAt: new Date().toISOString(),
      executionMs: Date.now() - startedAt
    },
    citations: []
  };
}

function mapRepository(repository) {
  return {
    id: nullableId(repository.id),
    name: nullableString(repository.name),
    fullName: nullableString(repository.full_name),
    description: nullableString(repository.description),
    private: booleanOrFalse(repository.private),
    fork: booleanOrFalse(repository.fork),
    archived: booleanOrFalse(repository.archived),
    disabled: booleanOrFalse(repository.disabled),
    htmlUrl: nullableString(repository.html_url),
    cloneUrl: nullableString(repository.clone_url),
    sshUrl: nullableString(repository.ssh_url),
    language: nullableString(repository.language),
    forksCount: numberOrZero(repository.forks_count),
    stargazersCount: numberOrZero(repository.stargazers_count),
    watchersCount: numberOrZero(repository.watchers_count),
    size: numberOrZero(repository.size),
    defaultBranch: nullableString(repository.default_branch),
    openIssuesCount: numberOrZero(repository.open_issues_count),
    topics: Array.isArray(repository.topics)
      ? repository.topics.filter(item => typeof item === 'string')
      : [],
    license: isObject(repository.license)
      ? {
        key: nullableString(repository.license.key),
        name: nullableString(repository.license.name),
        spdxId: nullableString(repository.license.spdx_id)
      }
      : null,
    createdAt: nullableString(repository.created_at),
    updatedAt: nullableString(repository.updated_at),
    pushedAt: nullableString(repository.pushed_at)
  };
}

function mapIssue(issue) {
  return {
    id: nullableId(issue.id),
    number: nullableId(issue.number),
    title: nullableString(issue.title),
    body: nullableString(issue.body),
    state: nullableString(issue.state),
    locked: booleanOrFalse(issue.locked),
    user: isObject(issue.user) ? mapActor(issue.user) : null,
    labels: Array.isArray(issue.labels)
      ? issue.labels.filter(isObject).map(label => ({
        id: nullableId(label.id),
        name: nullableString(label.name),
        color: nullableString(label.color),
        description: nullableString(label.description)
      }))
      : [],
    assignees: Array.isArray(issue.assignees) ? issue.assignees.filter(isObject).map(mapActor) : [],
    milestone: isObject(issue.milestone)
      ? {
        number: nullableId(issue.milestone.number),
        title: nullableString(issue.milestone.title),
        state: nullableString(issue.milestone.state),
        dueOn: nullableString(issue.milestone.due_on)
      }
      : null,
    comments: numberOrZero(issue.comments),
    createdAt: nullableString(issue.created_at),
    updatedAt: nullableString(issue.updated_at),
    closedAt: nullableString(issue.closed_at),
    htmlUrl: nullableString(issue.html_url)
  };
}

function mapPull(pull) {
  return {
    id: nullableId(pull.id),
    number: nullableId(pull.number),
    title: nullableString(pull.title),
    body: nullableString(pull.body),
    state: nullableString(pull.state),
    draft: booleanOrFalse(pull.draft),
    merged: booleanOrFalse(pull.merged),
    mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
    user: isObject(pull.user) ? mapActor(pull.user) : null,
    head: mapPullRef(pull.head),
    base: mapPullRef(pull.base),
    additions: numberOrZero(pull.additions),
    deletions: numberOrZero(pull.deletions),
    changedFiles: numberOrZero(pull.changed_files),
    commits: numberOrZero(pull.commits),
    comments: numberOrZero(pull.comments),
    reviewComments: numberOrZero(pull.review_comments),
    htmlUrl: nullableString(pull.html_url),
    createdAt: nullableString(pull.created_at),
    updatedAt: nullableString(pull.updated_at),
    closedAt: nullableString(pull.closed_at),
    mergedAt: nullableString(pull.merged_at)
  };
}

function mapPullRef(value) {
  if (!isObject(value)) return null;
  return {
    ref: nullableString(value.ref),
    sha: nullableString(value.sha),
    label: nullableString(value.label),
    repository: isObject(value.repo) ? nullableString(value.repo.full_name) : null
  };
}

function mapUser(user) {
  return {
    id: nullableId(user.id),
    login: nullableString(user.login),
    name: nullableString(user.name),
    email: nullableString(user.email),
    bio: nullableString(user.bio),
    company: nullableString(user.company),
    location: nullableString(user.location),
    blog: nullableString(user.blog),
    twitterUsername: nullableString(user.twitter_username),
    publicRepositories: numberOrZero(user.public_repos),
    publicGists: numberOrZero(user.public_gists),
    followers: numberOrZero(user.followers),
    following: numberOrZero(user.following),
    avatarUrl: nullableString(user.avatar_url),
    htmlUrl: nullableString(user.html_url),
    createdAt: nullableString(user.created_at),
    updatedAt: nullableString(user.updated_at)
  };
}

function mapActor(actor) {
  return {
    login: nullableString(actor.login),
    id: nullableId(actor.id),
    avatarUrl: nullableString(actor.avatar_url),
    htmlUrl: nullableString(actor.html_url),
    type: nullableString(actor.type)
  };
}

function extractRateLimit(headers) {
  return {
    limit: nullableHeaderInteger(headers.get('x-ratelimit-limit')),
    remaining: nullableHeaderInteger(headers.get('x-ratelimit-remaining')),
    reset: nullableHeaderInteger(headers.get('x-ratelimit-reset')),
    used: nullableHeaderInteger(headers.get('x-ratelimit-used')),
    resource: nullableString(headers.get('x-ratelimit-resource'))
  };
}

function snapshotKnownRecord(value, allowedFields) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!allowedFields.has(key) || !Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotOpenRecord(value) {
  const inspected = inspectRecord(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(inspected.descriptors)) {
    if (!Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result[key] = descriptor.value;
  }
  return result;
}

function inspectRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validationFailure();
  try {
    const prototype = Object.getPrototypeOf(value);
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
      throw validationFailure();
    }
    return { descriptors };
  } catch (error) {
    if (error instanceof GitHubFailure) throw error;
    throw validationFailure();
  }
}

function snapshotJson(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationFailure();
    return value;
  }
  if (typeof value !== 'object' || depth > 30 || seen.has(value)) throw validationFailure();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = snapshotArray(value).map(item => snapshotJson(item, seen, depth + 1));
      return result;
    }
    const record = snapshotOpenRecord(value);
    const result = Object.create(null);
    for (const [key, item] of Object.entries(record)) {
      result[key] = snapshotJson(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function snapshotArray(value) {
  let prototype;
  let symbols;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw validationFailure();
  }
  if (prototype !== Array.prototype || symbols.length > 0) throw validationFailure();
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 10000) throw validationFailure();
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw validationFailure();
    result.push(descriptor.value);
  }
  if (Object.keys(descriptors).some(key => key !== 'length' && !/^\d+$/.test(key))) {
    throw validationFailure();
  }
  return result;
}

function snapshotPrimitiveArray(value) {
  return snapshotArray(value).map(item => {
    if (item === null || ['string', 'boolean'].includes(typeof item)) return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    throw validationFailure();
  });
}

function optionalStringArray(value) {
  if (value === undefined) return [];
  return snapshotArray(value).map(item => requiredText(item, 256));
}

function readContext(context) {
  if (context === undefined || context === null) return { token: null, executionId: null };
  const record = snapshotOpenRecord(context);
  const secrets = record.secrets === undefined ? {} : snapshotOpenRecord(record.secrets);
  return {
    token: optionalSecret(secrets.GITHUB_TOKEN, null),
    executionId: record.executionId === undefined ? null : requiredText(record.executionId, 256)
  };
}

function requireToken(config) {
  if (!config.token) throw validationFailure();
}

function optionalSecret(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const token = requiredText(value, 4096);
  if (/[\r\n]/.test(token)) throw validationFailure();
  return token;
}

function requiredIdentifier(value) {
  return requiredText(value, 256);
}

function optionalIdentifier(value) {
  return value === undefined ? undefined : requiredIdentifier(value);
}

function requiredText(value, maxLength) {
  if (typeof value !== 'string') throw validationFailure();
  const text = value.trim();
  if (!text || text.length > maxLength) throw validationFailure();
  return text;
}

function optionalText(value, maxLength) {
  return value === undefined ? undefined : requiredText(value, maxLength);
}

function optionalString(value, fallback) {
  return value === undefined ? fallback : requiredText(value, 2048);
}

function optionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validationFailure();
  return value;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  return requiredInteger(value, min, max);
}

function requiredInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw validationFailure();
  return value;
}

function optionalInteger(value, min, max) {
  return value === undefined ? undefined : requiredInteger(value, min, max);
}

function optionalEnum(value, values, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value)) throw validationFailure();
  return value;
}

function compactObject(value) {
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    result[key] = item;
  }
  return result;
}

function requireArray(value) {
  if (!Array.isArray(value)) throw upstreamFailure();
  return value;
}

function requireObject(value) {
  if (!isObject(value)) throw upstreamFailure();
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value) {
  return typeof value === 'string' ? value : null;
}

function nullableId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : typeof value === 'string' && value.length > 0
      ? value
      : null;
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanOrFalse(value) {
  return value === true;
}

function nullableHeaderInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') ||
      host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
    return true;
  }
  if (host.startsWith('::ffff:')) return isPrivateOrLocalHost(host.slice(7));
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function validationFailure() {
  return new GitHubFailure(
    'GITHUB_VALIDATION',
    'Invalid GitHub integration request.',
    'ValidationError'
  );
}

function policyFailure() {
  return new GitHubFailure(
    'GITHUB_POLICY',
    'GitHub request policy denied the target.',
    'PolicyError'
  );
}

function timeoutFailure() {
  return new GitHubFailure(
    'GITHUB_TIMEOUT',
    'GitHub request timed out.',
    'TimeoutError',
    undefined,
    true
  );
}

function responseTooLargeFailure() {
  return new GitHubFailure(
    'GITHUB_RESPONSE_TOO_LARGE',
    'GitHub response exceeded the configured size limit.',
    'ResponseLimitError'
  );
}

function redirectFailure() {
  return new GitHubFailure(
    'GITHUB_REDIRECT',
    'GitHub redirect policy rejected the response.',
    'RedirectError'
  );
}

function apiFailure(status, rateLimit) {
  return new GitHubFailure(
    'GITHUB_API',
    'GitHub API request failed.',
    'GitHubApiError',
    status,
    status === 408 || status === 429 || status >= 500,
    rateLimit
  );
}

function upstreamFailure() {
  return new GitHubFailure(
    'GITHUB_UPSTREAM',
    'GitHub transport failed.',
    'UpstreamError',
    undefined,
    true
  );
}

function normalizeFailure(error) {
  const failure = error instanceof GitHubFailure ? error : upstreamFailure();
  return {
    message: failure.message,
    code: failure.code,
    type: failure.type,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retriable === undefined ? {} : { retriable: failure.retriable })
  };
}

function ensureFetch() {
  if (typeof fetch !== 'function') throw upstreamFailure();
}

if (typeof module !== 'undefined') {
  module.exports = { execute };
}
execute;
