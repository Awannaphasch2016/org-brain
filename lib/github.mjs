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

  async request(method, apiPath, { body } = {}) {
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
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = payload.message || response.statusText;
      throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${message}`);
    }
    return payload;
  }
}

export async function createSrsPullRequest(client, input) {
  const plan = planSrsPullRequest(input);
  if (!plan.ok) throw new Error(plan.error);
  const base = input.baseBranch;
  const ref = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/git/ref/heads/${base}`,
  );
  const stamp = input.stamp;
  const branch = `spec/${input.projectId}/srs/${stamp}`;
  await client.request("POST", `/repos/${client.owner}/${client.repo}/git/refs`, {
    body: { ref: `refs/heads/${branch}`, sha: ref.object.sha },
  });
  for (const file of input.files) {
    const path = assertSrsCommitPath(input.projectId, file.path);
    await client.request("PUT", `/repos/${client.owner}/${client.repo}/contents/${path}`, {
      body: {
        message: `Specify ${input.projectId}: ${path.split("/").pop()}`,
        content: Buffer.from(file.content, "utf8").toString("base64"),
        branch,
      },
    });
  }
  const title = input.title || `SRS for ${input.projectId}`;
  const pull = await client.request("POST", `/repos/${client.owner}/${client.repo}/pulls`, {
    body: {
      title,
      head: branch,
      base,
      draft: false,
      body: input.body,
    },
  });
  return {
    url: pull.html_url,
    number: pull.number,
    branch,
    headSha: pull.head.sha,
  };
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
  const base = input.baseBranch;
  const ref = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/git/ref/heads/${base}`,
  );
  const branch = `spec/${input.projectId}/srs-baseline/${input.stamp}`;
  await client.request("POST", `/repos/${client.owner}/${client.repo}/git/refs`, {
    body: { ref: `refs/heads/${branch}`, sha: ref.object.sha },
  });
  const current = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/contents/${path}?ref=${encodeURIComponent(base)}`,
  );
  await client.request("PUT", `/repos/${client.owner}/${client.repo}/contents/${path}`, {
    body: {
      message: `Record approved SRS baseline ${input.mergeCommitSha}`,
      content: Buffer.from(input.projectYaml, "utf8").toString("base64"),
      branch,
      sha: current.sha,
    },
  });
  const pull = await client.request("POST", `/repos/${client.owner}/${client.repo}/pulls`, {
    body: {
      title: `Record SRS baseline for ${input.projectId}`,
      head: branch,
      base,
      draft: false,
      body: [
        "Records the approved SRS baseline after a human merge.",
        "",
        `- Merge commit: \`${input.mergeCommitSha}\``,
        "- This pull request does not merge itself.",
      ].join("\n"),
    },
  });
  return { url: pull.html_url, number: pull.number, branch, headSha: pull.head.sha };
}
