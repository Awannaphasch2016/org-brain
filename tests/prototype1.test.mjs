import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { authorizeProject, authorizeSlackActor, planLoadProject } from "../lib/authz.mjs";
import {
  GithubClient,
  MERGE_FORBIDDEN,
  assertNotMergeRequest,
  buildSrsPullRequestBody,
  createSrsPullRequest,
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

test("GitHub client rejects merge and the create flow never calls it", async () => {
  assert.throws(() => assertNotMergeRequest("PUT", "/repos/o/r/pulls/1/merge"), /never merge/);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const path = new URL(url).pathname;
    if (path.endsWith("/git/ref/heads/main")) {
      return json({ object: { sha: "abc123" } });
    }
    if (path.endsWith("/git/refs")) return json({ ref: calls.at(-1).body.ref });
    if (path.includes("/contents/")) return json({ content: { path } });
    if (path.endsWith("/pulls")) {
      return json({ html_url: "https://github.com/o/r/pull/7", number: 7, head: { sha: "def456" } });
    }
    return json({});
  };
  const client = new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
  await assert.rejects(
    () => client.request("POST", "/repos/o/r/pulls/7/merge", { body: {} }),
    (error) => error instanceof Error && error.message === MERGE_FORBIDDEN,
  );
  const opened = await createSrsPullRequest(client, {
    projectId: "task-tracker-lite",
    baseBranch: "main",
    stamp: "20261109T201614Z",
    validationOk: true,
    title: "SRS",
    body: buildSrsPullRequestBody({
      projectId: "task-tracker-lite",
      baselineId: "TOR-001",
      gitCommit: null,
      sha256: "abc",
      summaryOfDecisions: "Statuses were confirmed.",
    }),
    files: [
      { path: "projects/task-tracker-lite/docs/srs.md", content: validSrs },
      { path: "projects/task-tracker-lite/docs/elicitation-log.md", content: "log" },
      { path: "projects/task-tracker-lite/docs/validation-report.md", content: "report" },
    ],
  });
  assert.equal(opened.number, 7);
  assert.equal(opened.branch, "spec/task-tracker-lite/srs/20261109T201614Z");
  assert.equal(calls.some((call) => call.url.includes("/merge")), false);
  assert.equal(client.calls.some((call) => call.path.includes("/merge")), false);
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

function json(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() {
      return JSON.stringify(body);
    },
  };
}
