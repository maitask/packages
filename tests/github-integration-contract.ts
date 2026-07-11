import {
  execute,
  type GitHubFailure,
  type GitHubListRepositoriesInput,
  type GitHubOptions,
  type GitHubRepository,
  type GitHubResult
} from '../github-integration';

const options = {
  baseUrl: 'https://api.github.com',
  timeoutMs: 30_000,
  maxResponseBytes: 4 * 1024 * 1024
} as const satisfies GitHubOptions;

const listInput = {
  action: 'listRepositories',
  owner: 'octocat',
  ownerType: 'user',
  perPage: 20,
  page: 1,
  sort: 'updated',
  direction: 'desc'
} as const satisfies GitHubListRepositoriesInput;

const repositories: Promise<GitHubResult<GitHubRepository>> = execute(listInput, options);
repositories.then(result => {
  if (result.success) {
    const name: string | null = result.data.items[0]!.data.fullName;
    const remaining: number | null = result.metadata.rateLimit.remaining;
    void [name, remaining];
  } else {
    const failure: GitHubFailure = result;
    const code: string = failure.error.code;
    void code;
  }
});

execute({
  action: 'createIssue',
  owner: 'acme',
  repository: 'demo',
  title: 'Production issue',
  labels: ['bug']
}, { token: 'configured-token' }, { executionId: 'exec-1' });

execute({
  action: 'request',
  method: 'GET',
  path: '/repos/acme/demo',
  responseType: 'json',
  headers: { Accept: 'application/vnd.github+json' }
}, options);

// @ts-expect-error GET and HEAD requests cannot carry bodies
execute({ action: 'request', method: 'GET', path: '/repos/acme/demo', body: { invalid: true } }, options);

// @ts-expect-error legacy actions are not supported
execute({ action: 'get-repo', owner: 'acme', repository: 'demo' }, options);

// @ts-expect-error legacy snake_case pagination is not supported
execute({ action: 'listRepositories', owner: 'acme', per_page: 20 }, options);

// @ts-expect-error custom request paths must be relative API paths
execute({ action: 'request', method: 'GET', path: 'https://attacker.example/steal' }, options);

execute({
  action: 'request',
  method: 'GET',
  path: '/repos/acme/demo',
  // @ts-expect-error authorization is managed by the package
  headers: { Authorization: 'Bearer caller-token' }
}, options);

repositories.then(result => {
  if (result.success) {
    // @ts-expect-error result items are readonly
    result.data.items[0]!.data.name = 'changed';
  }
});
