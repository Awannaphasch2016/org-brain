export const MERGE_FORBIDDEN =
  "Authored GitHub tools must never merge a pull request. A person merges in the GitHub UI.";

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

const SRS_COMMIT_FILES = new Set([
  "docs/srs.md",
  "docs/elicitation-log.md",
  "docs/validation-report.md",
  "docs/_analysis.md",
]);

export function assertNotMergeRequest(method, apiPath) {
  const path = String(apiPath).split("?")[0];
  if (/\/merge$/.test(path) || /\/pulls\/[^/]+\/merge$/.test(path)) {
    throw new Error(MERGE_FORBIDDEN);
  }
  if (String(method).toUpperCase() === "MERGE") throw new Error(MERGE_FORBIDDEN);
}

export function assertInsideProject(projectId, filePath) {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error(`invalid project id: ${projectId}`);
  }
  const normalized = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..") || normalized.includes("//")) {
    throw new Error(`refusing path outside projects/${projectId}/: ${filePath}`);
  }
  const prefix = `projects/${projectId}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`refusing path outside projects/${projectId}/: ${filePath}`);
  }
  return normalized;
}

export function assertSrsCommitPath(projectId, filePath) {
  const normalized = assertInsideProject(projectId, filePath);
  const rest = normalized.slice(`projects/${projectId}/`.length);
  if (rest === "docs/tor.md") {
    throw new Error("refusing to commit the frozen TOR");
  }
  if (!SRS_COMMIT_FILES.has(rest)) {
    throw new Error(`refusing to commit ${normalized}`);
  }
  return normalized;
}

export function assertBaselineCommitPath(projectId, filePath) {
  const normalized = assertInsideProject(projectId, filePath);
  const rest = normalized.slice(`projects/${projectId}/`.length);
  if (rest !== "project.yaml") {
    throw new Error("a baseline follow-up may only commit project.yaml");
  }
  return normalized;
}

export function planSrsPullRequest({ validationOk, files, projectId }) {
  if (!validationOk) {
    return {
      ok: false,
      error: "Refusing to open a pull request while validate_srs is not ok.",
    };
  }
  const accepted = [];
  for (const file of files) {
    if (/(?:^|\/)docs\/tor\.md$/.test(file.path)) {
      return { ok: false, error: "Refusing to commit a modified frozen TOR." };
    }
    accepted.push(assertSrsCommitPath(projectId, file.path));
  }
  if (!accepted.includes(`projects/${projectId}/docs/srs.md`)) {
    return { ok: false, error: "The pull request must include docs/srs.md." };
  }
  return { ok: true, paths: accepted };
}

export function buildSrsPullRequestBody({
  projectId,
  baselineId,
  gitCommit,
  sha256,
  summaryOfDecisions,
  errors = [],
  warnings = [],
}) {
  return [
    "## What was generated",
    "",
    `Software requirements specification for \`${projectId}\`.`,
    "",
    "## TOR baseline",
    "",
    `- Baseline ID: ${baselineId}`,
    `- Commit: ${gitCommit ?? "not yet recorded on the default branch"}`,
    `- SHA-256: \`${sha256}\``,
    "",
    "## Human decisions",
    "",
    summaryOfDecisions.trim() || "None recorded.",
    "",
    "## Validation",
    "",
    ...(errors.length === 0
      ? ["validate_srs passed."]
      : ["validate_srs failed.", ...errors.map((error) => `- ${error}`)]),
    "",
    "## Remaining non-blocking issues",
    "",
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
    "This pull request does not merge itself. A person reviews and merges it.",
    "",
  ].join("\n");
}

export function githubRepoFromEnv(env = process.env) {
  const full = env.GITHUB_REPOSITORY || "Awannaphasch2016/wewebplus-software-factory";
  const [owner, repo] = full.split("/");
  if (!owner || !repo || full.split("/").length !== 2) {
    throw new Error("GITHUB_REPOSITORY must be owner/repo");
  }
  return { owner, repo };
}

export class GithubClient {
  constructor({ fetchImpl = fetch, token, owner, repo }) {
    if (!token) throw new Error("GitHub token is missing.");
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.calls = [];
  }

  async request(method, apiPath, { body, allowNotFound = false } = {}) {
    assertNotMergeRequest(method, apiPath);
    const path = apiPath.startsWith("http")
      ? new URL(apiPath).pathname
      : apiPath.startsWith("/")
        ? apiPath
        : `/${apiPath}`;
    assertNotMergeRequest(method, path);
    const url = apiPath.startsWith("http") ? apiPath : `https://api.github.com${path}`;
    this.calls.push({ method: method.toUpperCase(), path });
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "user-agent": "wewebplus-software-factory",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.status === 404 && allowNotFound) return null;
        throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${text.slice(0, 200)}`);
      }
    }
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      const message = payload.message || response.statusText;
      throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${message}`);
    }
    return payload;
  }
}

function repoApi(client, suffix) {
  return `/repos/${client.owner}/${client.repo}${suffix}`;
}

function assertBranchIsNotBase(baseBranch, branch) {
  if (!branch || branch === baseBranch || branch.startsWith("refs/")) {
    throw new Error("Refusing to update the base branch.");
  }
}

function assertCommitLeavesTorUntouched(files) {
  for (const file of files) {
    const normalized = String(file.path).replace(/\\/g, "/");
    if (/(?:^|\/)docs\/tor\.md$/.test(normalized)) {
      throw new Error("Refusing to commit the frozen TOR.");
    }
  }
}

function refAlreadyExists(error) {
  return (
    error instanceof Error &&
    /failed \(422\)/.test(error.message) &&
    /Reference already exists/i.test(error.message)
  );
}

async function lookupBranchSha(client, branch) {
  const payload = await client.request("GET", repoApi(client, `/git/ref/heads/${branch}`), {
    allowNotFound: true,
  });
  if (payload === null) return null;
  const sha = payload.object && payload.object.sha;
  if (!sha) throw new Error(`GitHub ref heads/${branch} did not include a sha.`);
  return sha;
}

async function lookupFileSha(client, filePath, branch) {
  const payload = await client.request(
    "GET",
    repoApi(client, `/contents/${filePath}?ref=${encodeURIComponent(branch)}`),
    { allowNotFound: true },
  );
  if (payload === null) return null;
  if (
    Array.isArray(payload) ||
    payload.type === "dir" ||
    typeof payload.sha !== "string" ||
    !payload.sha
  ) {
    throw new Error(`Refusing to write ${filePath}: GitHub did not return a file sha.`);
  }
  return payload.sha;
}

async function pointBranchAt(client, branch, sha, { force }) {
  await client.request("PATCH", repoApi(client, `/git/refs/heads/${branch}`), {
    body: { sha, force },
  });
}

async function ensureBranchAtBase(client, baseBranch, branch, baseSha) {
  assertBranchIsNotBase(baseBranch, branch);
  const existing = await lookupBranchSha(client, branch);
  if (existing === null) {
    try {
      await client.request("POST", repoApi(client, "/git/refs"), {
        body: { ref: `refs/heads/${branch}`, sha: baseSha },
      });
      return;
    } catch (error) {
      if (!refAlreadyExists(error)) throw error;
    }
  }
  if (existing !== baseSha) {
    await pointBranchAt(client, branch, baseSha, { force: true });
  }
}

// One commit for every file. The branch is created at the base HEAD, or reset
// there when it already exists. Each path is read on that branch: a 404 creates
// the file, and an existing blob sha is an update in the new tree.
async function commitFilesOnBranch(client, { baseBranch, branch, message, files }) {
  assertCommitLeavesTorUntouched(files);
  assertBranchIsNotBase(baseBranch, branch);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Refusing to commit an empty file list.");
  }
  const baseRef = await client.request("GET", repoApi(client, `/git/ref/heads/${baseBranch}`));
  const baseSha = baseRef.object && baseRef.object.sha;
  if (!baseSha) throw new Error(`Base branch ${baseBranch} has no commit.`);
  await ensureBranchAtBase(client, baseBranch, branch, baseSha);
  const baseCommit = await client.request("GET", repoApi(client, `/git/commits/${baseSha}`));
  const baseTree = baseCommit.tree && baseCommit.tree.sha;
  if (!baseTree) throw new Error(`Base commit ${baseSha} has no tree.`);

  const tree = [];
  for (const file of files) {
    if (typeof file.content !== "string") {
      throw new Error(`Refusing to commit ${file.path} without text content.`);
    }
    // 404 returns null and the path is created. A blob sha means the path
    // already exists, so the tree entry below replaces that file.
    await lookupFileSha(client, file.path, branch);
    const blob = await client.request("POST", repoApi(client, "/git/blobs"), {
      body: { content: file.content, encoding: "utf-8" },
    });
    if (!blob.sha) throw new Error(`GitHub did not return a blob sha for ${file.path}.`);
    tree.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const createdTree = await client.request("POST", repoApi(client, "/git/trees"), {
    body: { base_tree: baseTree, tree },
  });
  if (!createdTree.sha) throw new Error("GitHub did not return the new tree sha.");
  const commit = await client.request("POST", repoApi(client, "/git/commits"), {
    body: { message, tree: createdTree.sha, parents: [baseSha] },
  });
  if (!commit.sha) throw new Error("GitHub did not return the new commit sha.");
  await pointBranchAt(client, branch, commit.sha, { force: false });
  return commit.sha;
}

async function openPull(client, { title, branch, baseBranch, body, headSha }) {
  const pull = await client.request("POST", repoApi(client, "/pulls"), {
    body: {
      title,
      head: branch,
      base: baseBranch,
      draft: false,
      body,
    },
  });
  return {
    url: pull.html_url,
    number: pull.number,
    branch,
    headSha: pull.head?.sha ?? headSha,
  };
}

export async function createSrsPullRequest(client, input) {
  const plan = planSrsPullRequest(input);
  if (!plan.ok) throw new Error(plan.error);
  const branch = `spec/${input.projectId}/srs/${input.stamp}`;
  const files = input.files.map((file) => ({
    path: assertSrsCommitPath(input.projectId, file.path),
    content: file.content,
  }));
  const headSha = await commitFilesOnBranch(client, {
    baseBranch: input.baseBranch,
    branch,
    message: `Specify ${input.projectId}`,
    files,
  });
  return openPull(client, {
    title: input.title || `SRS for ${input.projectId}`,
    branch,
    baseBranch: input.baseBranch,
    body: input.body,
    headSha,
  });
}

export async function openReviewedPullRequest(client, input) {
  const files = [];
  for (const file of input.files) {
    const normalized = assertInsideProject(input.projectId, file.path);
    if (isFixturePath(normalized) || /(?:^|\/)docs\/tor\.md$/.test(normalized)) {
      throw new Error("Refusing to commit a fixture or the frozen TOR.");
    }
    files.push({ path: normalized, content: file.content });
  }
  const headSha = await commitFilesOnBranch(client, {
    baseBranch: input.baseBranch,
    branch: input.branch,
    message: `${input.messagePrefix ?? "Update"} ${input.projectId}`,
    files,
  });
  return openPull(client, {
    title: input.title,
    branch: input.branch,
    baseBranch: input.baseBranch,
    body: input.body,
    headSha,
  });
}

function isFixturePath(filePath) {
  return String(filePath).replace(/\\/g, "/").includes("fixtures/");
}

export async function getPullRequestStatus(client, pullNumber) {
  const pull = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/pulls/${pullNumber}`,
  );
  const reviews = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/pulls/${pullNumber}/reviews`,
  );
  const reviewComments = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/pulls/${pullNumber}/comments`,
  );
  const issueComments = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/issues/${pullNumber}/comments`,
  );
  const requestedChanges = reviews
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => review.body)
    .filter(Boolean);
  return {
    number: pull.number,
    state: pull.state,
    merged: pull.merged === true,
    mergeCommitSha: pull.merge_commit_sha ?? null,
    url: pull.html_url,
    requestedChanges,
    comments: [...reviewComments, ...issueComments]
      .map((comment) => comment.body)
      .filter(Boolean),
  };
}

export async function openBaselinePullRequest(client, input) {
  if (!input.merged || !input.mergeCommitSha) {
    throw new Error("Refusing to record an SRS baseline before the pull request is merged.");
  }
  const path = assertBaselineCommitPath(input.projectId, input.projectYamlPath);
  const branch = `spec/${input.projectId}/srs-baseline/${input.stamp}`;
  const headSha = await commitFilesOnBranch(client, {
    baseBranch: input.baseBranch,
    branch,
    message: `Record approved SRS baseline ${input.mergeCommitSha}`,
    files: [{ path, content: input.projectYaml }],
  });
  return openPull(client, {
    title: `Record SRS baseline for ${input.projectId}`,
    branch,
    baseBranch: input.baseBranch,
    headSha,
    body: [
      "Records the approved SRS baseline after a human merge.",
      "",
      `- Merge commit: \`${input.mergeCommitSha}\``,
      "- This pull request does not merge itself.",
    ].join("\n"),
  });
}
