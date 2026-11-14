import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { authorizeProject, authorizeSlackActor, planLoadProject } from "../lib/authz.mjs";
import {
  GithubClient,
  MERGE_REFUSED,
  assertMergeAuthorized,
  buildSrsPullRequestBody,
  createSrsPullRequest,
  openBaselinePullRequest,
  openReviewedPullRequest,
  planSrsPullRequest,
} from "../lib/github.mjs";
import { parseSimpleYaml, setYamlPath } from "../lib/project-yaml.mjs";
import { sha256, validateSrs } from "../lib/srs-validate.mjs";
import { assessWrite } from "../lib/write-policy.mjs";

const root = new URL("..", import.meta.url);
const readRepo = (path) => readFile(new URL(path, root), "utf8");

const validSrs = `# Introduction

A team task tracker.

# Scope

In scope: tasks for one team. Out of scope: external customer access.

# Functional Requirements

### FR-001

The product shall let a team member add a task with a title.

Source: TOR 3.1

# Nonfunctional Requirements

### NFR-001

The product shall remain limited to the team.

Source: TOR 3.2

# Acceptance Criteria

### AC-001

A team member can add a titled task and see it listed.

Verifies: FR-001

# Constraints and References

Implementation details wait for later design.
`;

test("valid SRS passes when the TOR hash matches", () => {
  const tor = "frozen tor text\n";
  const result = validateSrs({
    srs: validSrs,
    torText: tor,
    expectedTorSha256: sha256(tor),
    elicitationLog: "",
    analysis: "## Gap register\n\n- G-001 | nonblocking | resolved | diagram not required\n",
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("duplicate ids, missing section, unknown acceptance link, and hash mismatch fail", () => {
  const duplicate = validateSrs({
    srs: validSrs.replace("### NFR-001", "### FR-001"),
    torText: "x",
    expectedTorSha256: sha256("x"),
  });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.includes("duplicate")));

  const missing = validateSrs({
    srs: validSrs.replace("# Acceptance Criteria\n\n### AC-001\n\nA team member can add a titled task and see it listed.\n\nVerifies: FR-001\n\n", ""),
    torText: "x",
    expectedTorSha256: sha256("x"),
  });
  assert.ok(missing.errors.some((error) => error.includes("Acceptance Criteria")));

  const unknown = validateSrs({
    srs: validSrs.replace("Verifies: FR-001", "Verifies: FR-999"),
    torText: "x",
    expectedTorSha256: sha256("x"),
  });
  assert.ok(unknown.errors.some((error) => error.includes("FR-999")));

  const hash = validateSrs({
    srs: validSrs,
    torText: "current",
    expectedTorSha256: sha256("other"),
  });
  assert.ok(hash.errors.some((error) => error.includes("TOR hash")));
});

test("TOR path changes, blocking gaps, and unresolved conflicts fail", () => {
  const tor = "frozen\n";
  const changed = validateSrs({
    srs: validSrs,
    torText: tor,
    expectedTorSha256: sha256(tor),
    changedPaths: ["projects/task-tracker-lite/docs/tor.md"],
  });
  assert.ok(changed.errors.some((error) => error.includes("frozen TOR")));

  const blocking = validateSrs({
    srs: validSrs,
    torText: tor,
    expectedTorSha256: sha256(tor),
    analysis: "## Gap register\n\n- G-001 | blocking | unresolved | permission model\n",
  });
  assert.ok(blocking.errors.some((error) => error.includes("blocking gap")));

  const conflict = validateSrs({
    srs: validSrs,
    torText: tor,
    expectedTorSha256: sha256(tor),
    elicitationLog: "## EL-001\n\n- class: conflict\n- resolution: unresolved\n",
  });
  assert.ok(conflict.errors.some((error) => error.includes("EL-001")));

  const resolved = validateSrs({
    srs: validSrs,
    torText: tor,
    expectedTorSha256: sha256(tor),
    elicitationLog: "## EL-001\n\n- class: conflict\n- resolution: rejected\n",
  });
  assert.equal(resolved.ok, true, resolved.errors.join("\n"));
});

test("authorization is fail-closed", () => {
  assert.equal(authorizeSlackActor({ userId: "U0CFRUV378D", allowedUserIds: ["U0CFRUV378D"] }).allowed, true);
  assert.equal(authorizeSlackActor({ userId: "U0000000000", allowedUserIds: ["U0CFRUV378D"] }).allowed, false);
  assert.equal(authorizeSlackActor({ userId: "U0CFRUV378D", allowedUserIds: [] }).allowed, false);
  assert.equal(authorizeProject({ userId: "U0CFRUV378D", projectAllowedUserIds: [] }).allowed, false);
  const denied = planLoadProject({
    userId: "U0CFRUV378D",
    allowedUserIds: ["U0CFRUV378D"],
    projectAllowedUserIds: ["UOTHER"],
  });
  assert.equal(denied.denied, true);
  assert.equal(denied.fetch, false);
  const unknown = planLoadProject({
    userId: "UINTRUDER",
    allowedUserIds: ["U0CFRUV378D"],
    projectAllowedUserIds: ["U0CFRUV378D"],
  });
  assert.equal(unknown.fetch, false);
});

test("sandbox writes cannot touch the TOR, knowledge, or src", () => {
  assert.equal(assessWrite("projects/task-tracker-lite/docs/srs.md").allowed, true);
  assert.equal(assessWrite("/workspace/projects/task-tracker-lite/docs/tor.md").allowed, false);
  assert.equal(assessWrite("knowledge/guidelines/tor-structure.md").allowed, false);
  assert.equal(assessWrite("projects/task-tracker-lite/src/main.ts").allowed, false);
  assert.equal(assessWrite("../secrets").allowed, false);
});

test("pull request planning refuses failed validation and the TOR", () => {
  const refused = planSrsPullRequest({
    validationOk: false,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/srs.md" }],
  });
  assert.equal(refused.ok, false);
  const tor = planSrsPullRequest({
    validationOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/tor.md" }],
  });
  assert.equal(tor.ok, false);
  assert.match(tor.error, /frozen TOR/);
});

test("GitHub client rejects an unapproved merge and the create flow never calls it", async () => {
  assert.throws(
    () => assertMergeAuthorized("PUT", "/repos/o/r/pulls/1/merge", { sha: "abc" }, undefined),
    new RegExp(MERGE_REFUSED),
  );
  const harness = githubHarness();
  const client = new GithubClient({
    fetchImpl: harness.fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
  });
  await assert.rejects(
    () => client.request("POST", "/repos/o/r/pulls/7/merge", { body: {} }),
    (error) => error instanceof Error && error.message === MERGE_REFUSED,
  );
  const opened = await createSrsPullRequest(client, srsInput());
  assert.equal(opened.number, 7);
  assert.equal(opened.branch, "spec/task-tracker-lite/srs/20261109T201614Z");
  assert.equal(opened.headSha, "commit-new");
  assert.equal(harness.calls.some((call) => call.url.includes("/merge")), false);
  assert.equal(client.calls.some((call) => call.path.includes("/merge")), false);
  assert.equal(harness.calls.some((call) => call.method === "DELETE"), false);
  assert.equal(harness.calls.some((call) => call.method === "PUT"), false);
});

test("an existing file is updated and a missing file is created in one commit", async () => {
  const logPath = "projects/task-tracker-lite/docs/elicitation-log.md";
  const reportPath = "projects/task-tracker-lite/docs/validation-report.md";
  const harness = githubHarness({
    files: { [logPath]: "sha-log" },
  });
  const client = new GithubClient({
    fetchImpl: harness.fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
  });
  const opened = await createSrsPullRequest(client, srsInput());
  assert.equal(opened.branch, "spec/task-tracker-lite/srs/20261109T201614Z");
  const logLookup = contentsCall(harness, logPath);
  const reportLookup = contentsCall(harness, reportPath);
  assert.equal(new URL(logLookup.url).searchParams.get("ref"), opened.branch);
  assert.equal(new URL(reportLookup.url).searchParams.get("ref"), opened.branch);
  assert.equal(harness.state.commits.length, 1);
  assert.deepEqual(harness.state.commits[0].parents, ["abc123"]);
  const tree = harness.state.trees[0];
  assert.equal(tree.base_tree, "tree-base");
  const srsPath = "projects/task-tracker-lite/docs/srs.md";
  const logEntry = tree.tree.find((entry) => entry.path === logPath);
  const reportEntry = tree.tree.find((entry) => entry.path === reportPath);
  const srsEntry = tree.tree.find((entry) => entry.path === srsPath);
  assert.equal(tree.tree.length, 3);
  assert.equal(logEntry.type, "blob");
  assert.notEqual(logEntry.sha, "sha-log");
  assert.equal(reportEntry.type, "blob");
  assert.equal(srsEntry.type, "blob");
  assert.ok(contentsCall(harness, srsPath));
  assert.equal(harness.calls.filter((call) => call.method === "PUT").length, 0);
  assert.equal(harness.state.branches[opened.branch], "commit-new");
  assert.equal(harness.state.baseSha, "abc123");
});

test("an SRS branch left by a failed attempt is reset onto the current base", async () => {
  const branch = "spec/task-tracker-lite/srs/20261110T045607Z";
  const harness = githubHarness({
    files: { "projects/task-tracker-lite/docs/elicitation-log.md": "sha-log" },
    branches: { [branch]: "straysha" },
  });
  const client = new GithubClient({
    fetchImpl: harness.fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
  });
  const opened = await createSrsPullRequest(client, srsInput("20261110T045607Z"));
  assert.equal(opened.branch, branch);
  const reset = harness.calls.find(
    (call) => call.method === "PATCH" && call.body?.force === true && call.body.sha === "abc123",
  );
  assert.ok(reset);
  assert.match(reset.path, /\/git\/refs\/heads\/spec\/task-tracker-lite\/srs\/20261110T045607Z$/);
  const resetAt = harness.calls.indexOf(reset);
  const lookupAt = harness.calls.findIndex((call) => call.path.includes("/contents/"));
  const commitAt = harness.calls.findIndex((call) => call.path.endsWith("/git/commits"));
  assert.ok(resetAt < lookupAt && lookupAt < commitAt);
  assert.equal(harness.state.commits.length, 1);
  assert.deepEqual(harness.state.commits[0].parents, ["abc123"]);
  assert.equal(harness.state.branches[branch], "commit-new");
  assert.equal(harness.state.baseSha, "abc123");
  assert.equal(
    harness.calls.some((call) => call.method === "PATCH" && call.path.endsWith("/git/refs/heads/main")),
    false,
  );
  assert.equal(harness.calls.some((call) => call.method === "DELETE"), false);
});

test("reviewed and baseline pull requests update an existing project file without deleting the base", async () => {
  const projectPath = "projects/task-tracker-lite/project.yaml";
  const harness = githubHarness({ files: { [projectPath]: "sha-yaml" } });
  const client = new GithubClient({
    fetchImpl: harness.fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
  });
  await assert.rejects(
    () =>
      openReviewedPullRequest(client, {
        projectId: "task-tracker-lite",
        baseBranch: "main",
        branch: "change/task-tracker-lite/stamp",
        title: "no",
        body: "no",
        files: [{ path: "projects/task-tracker-lite/docs/tor.md", content: "edited" }],
      }),
    /frozen TOR/,
  );
  assert.equal(harness.calls.length, 0);
  const opened = await openBaselinePullRequest(client, {
    projectId: "task-tracker-lite",
    baseBranch: "main",
    stamp: "20261110T050000Z",
    merged: true,
    mergeCommitSha: "mergedsha",
    projectYamlPath: projectPath,
    projectYaml: "id: task-tracker-lite\n",
  });
  assert.equal(opened.branch, "spec/task-tracker-lite/srs-baseline/20261110T050000Z");
  const lookup = contentsCall(harness, projectPath);
  assert.equal(new URL(lookup.url).searchParams.get("ref"), opened.branch);
  assert.equal(harness.state.trees[0].tree[0].path, projectPath);
  assert.notEqual(harness.state.trees[0].tree[0].sha, "sha-yaml");
  assert.equal(harness.calls.some((call) => call.method === "PUT" || call.method === "DELETE"), false);
  assert.equal(harness.state.baseSha, "abc123");
});

test("project.yaml hash matches the frozen TOR and baseline fields can be recorded", async () => {
  const tor = await readRepo("projects/task-tracker-lite/docs/tor.md");
  const yaml = await readRepo("projects/task-tracker-lite/project.yaml");
  const project = parseSimpleYaml(yaml);
  assert.equal(project.tor.baselineId, "TOR-001");
  assert.equal(project.tor.status, "frozen");
  assert.equal(project.tor.sha256, sha256(tor));
  assert.equal(project.authorization.allowedSlackUserIds[0], "U0CFRUV378D");
  assert.ok(tor.includes("External customer access"));
  const updated = setYamlPath(
    setYamlPath(yaml, "srs.status", "approved"),
    "srs.baseline.mergeCommit",
    "abc123",
  );
  const parsed = parseSimpleYaml(updated);
  assert.equal(parsed.srs.status, "approved");
  assert.equal(parsed.srs.baseline.mergeCommit, "abc123");
  assert.equal(parsed.tor.sha256, project.tor.sha256);
});

test("guidelines stay project-agnostic and channel files fail closed", async () => {
  const files = await readdir(new URL("knowledge/guidelines/", root));
  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const text = await readRepo(`knowledge/guidelines/${file}`);
    assert.equal(/task-tracker|task tracker|eve-forman|harness-level/i.test(text), false, file);
  }
  const slack = await readRepo("agents/specification/agent/channels/slack.ts");
  const eve = await readRepo("agents/specification/agent/channels/eve.ts");
  const ask = await readRepo("agents/specification/agent/tools/ask_question.ts");
  assert.equal(slack.includes("auth: null"), false);
  assert.equal(slack.includes("defaultSlackAuth"), true);
  assert.match(slack, /async onDirectMessage\(\) \{\n    return null;/);
  assert.match(eve, /vercelOidc\(\), localDev\(\)/);
  assert.equal(eve.includes("none("), false);
  assert.match(ask, /export default askQuestion;\s*$/);
  assert.equal(ask.includes("askQuestion()"), false);
});

test("knowledge verification passes", () => {
  const result = spawnSync("node", ["scripts/verify-knowledge.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

function srsInput(stamp = "20261109T201614Z") {
  return {
    projectId: "task-tracker-lite",
    baseBranch: "main",
    stamp,
    validationOk: true,
    title: "SRS",
    body: buildSrsPullRequestBody({
      projectId: "task-tracker-lite",
      baselineId: "TOR-001",
      gitCommit: "33df89bb531e635f8fea2f751d9559c15c3a4065",
      sha256: "abc",
      summaryOfDecisions: "Statuses were confirmed.",
    }),
    files: [
      { path: "projects/task-tracker-lite/docs/srs.md", content: validSrs },
      { path: "projects/task-tracker-lite/docs/elicitation-log.md", content: "log" },
      { path: "projects/task-tracker-lite/docs/validation-report.md", content: "report" },
    ],
  };
}

function contentsCall(harness, filePath) {
  const call = harness.calls.find(
    (entry) => entry.method === "GET" && entry.path.includes(`/contents/${filePath}`),
  );
  assert.ok(call, filePath);
  return call;
}

function githubHarness({ baseBranch = "main", baseSha = "abc123", files = {}, branches = {} } = {}) {
  const calls = [];
  const state = {
    baseSha,
    branches: { ...branches },
    commits: [],
    trees: [],
    blobCount: 0,
  };
  const fetchImpl = async (url, init) => {
    const method = init.method.toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const parsed = new URL(url);
    calls.push({ method, path: parsed.pathname, body, url });
    if (method === "DELETE") return http({ message: "delete is not allowed" }, 403);
    if (method === "PUT" && parsed.pathname.includes("/contents/")) {
      return http({ message: "`sha` wasn't supplied" }, 422);
    }
    if (method === "GET" && parsed.pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(parsed.pathname.split("/git/ref/heads/")[1]);
      if (name === baseBranch) return http({ object: { sha: state.baseSha } });
      if (!state.branches[name]) return http({ message: "Not Found" }, 404);
      return http({ object: { sha: state.branches[name] } });
    }
    if (method === "GET" && parsed.pathname.includes("/git/commits/")) {
      return http({ sha: state.baseSha, tree: { sha: "tree-base" } });
    }
    if (method === "GET" && parsed.pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(parsed.pathname.split("/contents/")[1]);
      const sha = files[filePath];
      if (!sha) return http({ message: "Not Found" }, 404);
      return http({ type: "file", path: filePath, sha });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/blobs")) {
      state.blobCount += 1;
      const sha = `blob-${state.blobCount}`;
      return http({ sha });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/trees")) {
      state.trees.push(body);
      return http({ sha: "tree-new" });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/commits")) {
      state.commits.push(body);
      return http({ sha: "commit-new" });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/refs")) {
      const name = body.ref.replace(/^refs\/heads\//, "");
      if (name === baseBranch) return http({ message: "refusing to create the base branch" }, 403);
      if (state.branches[name]) return http({ message: "Reference already exists" }, 422);
      state.branches[name] = body.sha;
      return http({ ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "PATCH" && parsed.pathname.includes("/git/refs/heads/")) {
      const name = decodeURIComponent(parsed.pathname.split("/git/refs/heads/")[1]);
      if (name === baseBranch) return http({ message: "refusing to update the base branch" }, 403);
      state.branches[name] = body.sha;
      return http({ ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    if (method === "POST" && parsed.pathname.endsWith("/pulls")) {
      return http({
        html_url: "https://github.com/o/r/pull/7",
        number: 7,
        head: { sha: state.branches[body.head] },
      });
    }
    return http({ message: `unhandled ${method} ${parsed.pathname}` }, 500);
  };
  return { calls, fetchImpl, state };
}

function http(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(body);
    },
  };
}
