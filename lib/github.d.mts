export const MERGE_REFUSED: string;

export function assertMergeAuthorized(
  method: string,
  apiPath: string,
  body: { sha?: string; merge_method?: string } | undefined,
  mergeAuthorization: unknown,
): void;
export function assertInsideProject(projectId: string, filePath: string): string;
export function assertSrsCommitPath(projectId: string, filePath: string): string;
export function assertSetupCommitPath(projectId: string, filePath: string): string;
export function assertBaselineCommitPath(projectId: string, filePath: string): string;
export function openSetupPullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    baseBranch: string;
    stamp: string;
    title?: string;
    body: string;
    files: readonly { path: string; content: string }[];
  },
): Promise<{ url: string; number: number; branch: string; headSha: string }>;
export function openProjectYamlPullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    baseBranch: string;
    branch: string;
    title: string;
    body: string;
    message: string;
    projectYamlPath?: string;
    projectYaml: string;
  },
): Promise<{ url: string; number: number; branch: string; headSha: string; projectYaml: string }>;
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
  identity: { kind: string; botLogin: string; label: string } | null;
  calls: { method: string; path: string; body?: unknown }[];
  constructor(input: {
    fetchImpl?: typeof fetch;
    token: string;
    owner: string;
    repo: string;
    identity?: { kind: string; botLogin: string; label: string } | null;
  });
  request(
    method: string,
    apiPath: string,
    init?: { body?: unknown; allowNotFound?: boolean; mergeAuthorization?: unknown },
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
  headSha: string | null;
  headRef: string | null;
  baseSha: string | null;
  mergedBy: string | null;
  body: string;
  requestedChanges: string[];
  comments: string[];
}>;

export function listIssueComments(
  client: GithubClient,
  pullNumber: number,
): Promise<{ id: number | null; body: string; authorLogin: string | null }[]>;

export function commentOnPullRequest(client: GithubClient, pullNumber: number, body: string): Promise<any>;
export function closePullRequest(client: GithubClient, pullNumber: number): Promise<any>;
export function listPullRequestCommits(client: GithubClient, pullNumber: number): Promise<any[]>;
export function humanCommitsSince(
  commits: readonly { sha: string; authorLogin: string | null; message?: string; files?: readonly { filename: string; additions?: number; deletions?: number }[] }[],
  options?: { botLogin?: string | null; afterSha?: string | null },
): { sha: string; summary: string; files: readonly { filename: string; additions?: number; deletions?: number }[]; additions: number; deletions: number }[];
export function getCombinedStatus(client: GithubClient, sha: string): Promise<{ state: string; checkRuns: { name: string; status: string; conclusion: string | null }[] }>;
export function readRepoBytes(client: GithubClient, filePath: string, ref: string): Promise<Buffer | null>;
export function readRepoTextFile(client: GithubClient, filePath: string, ref: string): Promise<string | null>;
export function mergeApprovedPullRequest(
  client: GithubClient,
  input: {
    pullNumber: number;
    projectId?: string;
    allowedUserIds: readonly string[];
    signingSecret?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<any>;
export function mergeRecordingPullRequest(
  client: GithubClient,
  input: {
    pullNumber: number;
    allowedUserIds: readonly string[];
    signingSecret?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<any>;

export function openBaselinePullRequest(
  client: GithubClient,
  input: {
    projectId: string;
    block?: "tor" | "srs" | "architecture" | string;
    baseBranch: string;
    stamp: string;
    merged: boolean;
    mergeCommitSha: string | null;
    headRef: string | null;
    sourcePr: number;
    sourceHeadSha: string;
    projectYamlPath: string;
    projectYaml: string;
  },
): Promise<{
  url: string;
  number: number;
  branch: string;
  headSha: string;
  reference: Record<string, unknown>;
  projectYaml: string;
}>;

export function recordApprovedBaseline(
  client: GithubClient,
  input: {
    projectId: string;
    block: string;
    pullNumber: number;
    stamp: string;
    allowedUserIds: readonly string[];
    signingSecret?: string;
    baseBranch?: string;
  },
): Promise<{
  url: string;
  number: number;
  branch: string;
  headSha: string;
  reference: Record<string, unknown>;
  projectYaml: string;
  approvedBy: string;
  approvedAt: string;
  sha256: string;
}>;
