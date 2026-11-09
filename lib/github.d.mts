export const MERGE_FORBIDDEN: string;

export function assertNotMergeRequest(method: string, apiPath: string): void;
export function assertInsideProject(projectId: string, filePath: string): string;
export function assertSrsCommitPath(projectId: string, filePath: string): string;
export function assertBaselineCommitPath(projectId: string, filePath: string): string;
export function planSrsPullRequest(input: {
  validationOk: boolean;
  projectId: string;
  files: readonly { path: string; content?: string }[];
}): { ok: true; paths: string[] } | { ok: false; error: string };
export function buildSrsPullRequestBody(input: {
  projectId: string;
  baselineId: string;
  gitCommit: string | null;
  sha256: string;
  summaryOfDecisions: string;
  errors?: readonly string[];
  warnings?: readonly string[];
}): string;

export function githubRepoFromEnv(env?: NodeJS.ProcessEnv): { owner: string; repo: string };

export class GithubClient {
  owner: string;
  repo: string;
  calls: { method: string; path: string }[];
  constructor(input: {
    fetchImpl?: typeof fetch;
    token: string;
    owner: string;
    repo: string;
  });
  request(
    method: string,
    apiPath: string,
    init?: { body?: unknown },
  ): Promise<any>;
}

export function createSrsPullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    baseBranch: string;
    title?: string;
    body: string;
    stamp: string;
    validationOk: boolean;
    files: readonly { path: string; content: string }[];
  },
): Promise<{ url: string; number: number; branch: string; headSha: string }>;

export function openReviewedPullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
    messagePrefix?: string;
    files: readonly { path: string; content: string; sha?: string }[];
  },
): Promise<{ url: string; number: number; branch: string; headSha: string }>;

export function getPullRequestStatus(
  client: GithubClient,
  pullNumber: number,
): Promise<{
  number: number;
  state: string;
  merged: boolean;
  mergeCommitSha: string | null;
  url: string;
  requestedChanges: string[];
  comments: string[];
}>;

export function openBaselinePullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    baseBranch: string;
    stamp: string;
    merged: boolean;
    mergeCommitSha: string | null;
    projectYamlPath: string;
    projectYaml: string;
  },
): Promise<{ url: string; number: number; branch: string; headSha: string }>;
