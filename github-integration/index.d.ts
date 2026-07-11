export type GitHubJsonPrimitive = string | number | boolean | null;
export type GitHubJsonValue =
  | GitHubJsonPrimitive
  | readonly GitHubJsonValue[]
  | { readonly [key: string]: GitHubJsonValue };

export type GitHubAction =
  | 'listRepositories'
  | 'getRepository'
  | 'listIssues'
  | 'createIssue'
  | 'listPullRequests'
  | 'getPullRequest'
  | 'createPullRequest'
  | 'getUser'
  | 'request';

export interface GitHubOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
}

export interface GitHubSecrets {
  readonly GITHUB_TOKEN?: string;
}

export interface GitHubContext {
  readonly secrets?: GitHubSecrets;
  readonly executionId?: string;
  readonly [key: string]: unknown;
}

export interface GitHubPaginationInput {
  readonly perPage?: number;
  readonly page?: number;
}

export interface GitHubListRepositoriesInput extends GitHubPaginationInput {
  readonly action: 'listRepositories';
  readonly owner?: string;
  readonly ownerType?: 'user' | 'organization';
  readonly repositoryType?: 'all' | 'owner' | 'member' | 'public' | 'private' | 'forks' | 'sources';
  readonly sort?: 'created' | 'updated' | 'pushed' | 'full_name';
  readonly direction?: 'asc' | 'desc';
}

export interface GitHubGetRepositoryInput {
  readonly action: 'getRepository';
  readonly owner: string;
  readonly repository: string;
}

export interface GitHubListIssuesInput extends GitHubPaginationInput {
  readonly action: 'listIssues';
  readonly owner: string;
  readonly repository: string;
  readonly state?: 'open' | 'closed' | 'all';
  readonly sort?: 'created' | 'updated' | 'comments';
  readonly direction?: 'asc' | 'desc';
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly mentioned?: string;
  readonly milestone?: number;
}

export interface GitHubCreateIssueInput {
  readonly action: 'createIssue';
  readonly owner: string;
  readonly repository: string;
  readonly title: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
  readonly milestone?: number;
}

export interface GitHubListPullRequestsInput extends GitHubPaginationInput {
  readonly action: 'listPullRequests';
  readonly owner: string;
  readonly repository: string;
  readonly state?: 'open' | 'closed' | 'all';
  readonly sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  readonly direction?: 'asc' | 'desc';
  readonly head?: string;
  readonly base?: string;
}

export interface GitHubGetPullRequestInput {
  readonly action: 'getPullRequest';
  readonly owner: string;
  readonly repository: string;
  readonly pullNumber: number;
}

export interface GitHubCreatePullRequestInput {
  readonly action: 'createPullRequest';
  readonly owner: string;
  readonly repository: string;
  readonly title: string;
  readonly head: string;
  readonly base: string;
  readonly body?: string;
  readonly draft?: boolean;
}

export interface GitHubGetUserInput {
  readonly action: 'getUser';
  readonly username?: string;
}

export type GitHubRelativePath = `/${string}`;
export type GitHubRequestMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type GitHubResponseType = 'json' | 'text';

export type GitHubRequestHeaders = Readonly<Record<string, string>> & {
  readonly Authorization?: never;
  readonly authorization?: never;
  readonly Cookie?: never;
  readonly cookie?: never;
  readonly Host?: never;
  readonly host?: never;
  readonly 'Proxy-Authorization'?: never;
  readonly 'proxy-authorization'?: never;
  readonly 'User-Agent'?: never;
  readonly 'user-agent'?: never;
  readonly 'X-GitHub-Api-Version'?: never;
  readonly 'x-github-api-version'?: never;
};

export type GitHubQueryValue = GitHubJsonPrimitive | readonly GitHubJsonPrimitive[];

export interface GitHubRequestBaseInput {
  readonly action: 'request';
  readonly path: GitHubRelativePath;
  readonly query?: Readonly<Record<string, GitHubQueryValue>>;
  readonly headers?: GitHubRequestHeaders;
  readonly responseType?: GitHubResponseType;
}

export interface GitHubReadRequestInput extends GitHubRequestBaseInput {
  readonly method: 'GET' | 'HEAD';
  readonly body?: never;
}

export interface GitHubWriteRequestInput extends GitHubRequestBaseInput {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: GitHubJsonValue;
}

export type GitHubRequestInput = GitHubReadRequestInput | GitHubWriteRequestInput;

export type GitHubInput =
  | GitHubListRepositoriesInput
  | GitHubGetRepositoryInput
  | GitHubListIssuesInput
  | GitHubCreateIssueInput
  | GitHubListPullRequestsInput
  | GitHubGetPullRequestInput
  | GitHubCreatePullRequestInput
  | GitHubGetUserInput
  | GitHubRequestInput;

export interface GitHubLicense {
  readonly key: string | null;
  readonly name: string | null;
  readonly spdxId: string | null;
}

export interface GitHubRepository {
  readonly id: string | number | null;
  readonly name: string | null;
  readonly fullName: string | null;
  readonly description: string | null;
  readonly private: boolean;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly disabled: boolean;
  readonly htmlUrl: string | null;
  readonly cloneUrl: string | null;
  readonly sshUrl: string | null;
  readonly language: string | null;
  readonly forksCount: number;
  readonly stargazersCount: number;
  readonly watchersCount: number;
  readonly size: number;
  readonly defaultBranch: string | null;
  readonly openIssuesCount: number;
  readonly topics: readonly string[];
  readonly license: GitHubLicense | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly pushedAt: string | null;
}

export interface GitHubActor {
  readonly login: string | null;
  readonly id: string | number | null;
  readonly avatarUrl: string | null;
  readonly htmlUrl: string | null;
  readonly type: string | null;
}

export interface GitHubIssueLabel {
  readonly id: string | number | null;
  readonly name: string | null;
  readonly color: string | null;
  readonly description: string | null;
}

export interface GitHubMilestone {
  readonly number: string | number | null;
  readonly title: string | null;
  readonly state: string | null;
  readonly dueOn: string | null;
}

export interface GitHubIssue {
  readonly id: string | number | null;
  readonly number: string | number | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly state: string | null;
  readonly locked: boolean;
  readonly user: GitHubActor | null;
  readonly labels: readonly GitHubIssueLabel[];
  readonly assignees: readonly GitHubActor[];
  readonly milestone: GitHubMilestone | null;
  readonly comments: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly htmlUrl: string | null;
}

export interface GitHubPullReference {
  readonly ref: string | null;
  readonly sha: string | null;
  readonly label: string | null;
  readonly repository: string | null;
}

export interface GitHubPullRequest {
  readonly id: string | number | null;
  readonly number: string | number | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly state: string | null;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly mergeable: boolean | null;
  readonly user: GitHubActor | null;
  readonly head: GitHubPullReference | null;
  readonly base: GitHubPullReference | null;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly commits: number;
  readonly comments: number;
  readonly reviewComments: number;
  readonly htmlUrl: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
}

export interface GitHubUser {
  readonly id: string | number | null;
  readonly login: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly bio: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly blog: string | null;
  readonly twitterUsername: string | null;
  readonly publicRepositories: number;
  readonly publicGists: number;
  readonly followers: number;
  readonly following: number;
  readonly avatarUrl: string | null;
  readonly htmlUrl: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface GitHubRateLimit {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly reset: number | null;
  readonly used: number | null;
  readonly resource: string | null;
}

export interface GitHubItem<T> {
  readonly index: number;
  readonly id?: string;
  readonly data: T;
}

export interface GitHubSummary {
  readonly total: number;
  readonly success_count: number;
  readonly failure_count: number;
}

export interface GitHubSuccessMetadata {
  readonly package: '@maitask/github-integration';
  readonly version: '1.0.0';
  readonly provider: 'github';
  readonly action: GitHubAction;
  readonly executionId: string | null;
  readonly status: number;
  readonly redirects: number;
  readonly rateLimit: GitHubRateLimit;
  readonly executedAt: string;
  readonly executionMs: number;
}

export interface GitHubFailureMetadata {
  readonly package: '@maitask/github-integration';
  readonly version: '1.0.0';
  readonly provider: 'github';
  readonly action: GitHubAction | null;
  readonly executionId: string | null;
  readonly rateLimit: GitHubRateLimit | null;
  readonly executedAt: string;
  readonly executionMs: number;
}

export type GitHubErrorCode =
  | 'GITHUB_VALIDATION'
  | 'GITHUB_POLICY'
  | 'GITHUB_TIMEOUT'
  | 'GITHUB_RESPONSE_TOO_LARGE'
  | 'GITHUB_REDIRECT'
  | 'GITHUB_API'
  | 'GITHUB_UPSTREAM';

export interface GitHubError {
  readonly message: string;
  readonly code: GitHubErrorCode;
  readonly type:
    | 'ValidationError'
    | 'PolicyError'
    | 'TimeoutError'
    | 'ResponseLimitError'
    | 'RedirectError'
    | 'GitHubApiError'
    | 'UpstreamError';
  readonly status?: number;
  readonly retriable?: boolean;
}

export interface GitHubSuccess<T> {
  readonly success: true;
  readonly data: {
    readonly items: readonly GitHubItem<T>[];
    readonly summary: GitHubSummary;
  };
  readonly error: null;
  readonly metadata: GitHubSuccessMetadata;
  readonly citations: readonly [];
}

export interface GitHubFailure {
  readonly success: false;
  readonly error: GitHubError;
  readonly metadata: GitHubFailureMetadata;
  readonly citations: readonly [];
}

export type GitHubResult<T> = GitHubSuccess<T> | GitHubFailure;
export type GitHubCustomResponse = GitHubJsonValue | string;

export function execute(
  input: GitHubListRepositoriesInput | GitHubGetRepositoryInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubRepository>>;

export function execute(
  input: GitHubListIssuesInput | GitHubCreateIssueInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubIssue>>;

export function execute(
  input: GitHubListPullRequestsInput | GitHubGetPullRequestInput | GitHubCreatePullRequestInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubPullRequest>>;

export function execute(
  input: GitHubGetUserInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubUser>>;

export function execute(
  input: GitHubRequestInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubCustomResponse>>;

export function execute(
  input: GitHubInput,
  options?: GitHubOptions,
  context?: GitHubContext
): Promise<GitHubResult<GitHubRepository | GitHubIssue | GitHubPullRequest | GitHubUser | GitHubCustomResponse>>;
