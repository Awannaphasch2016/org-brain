import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GithubClient } from "../lib/github.mjs";
import { sha256Bytes } from "../lib/baseline.mjs";
import {
  classifyRef,
  loadApprovedSrs,
  loadApprovedTor,
  loadChangeControlSources,
  loadProjectFiles,
} from "../lib/project-files.mjs";
import { resolveStageInput } from "../lib/stage-gate.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root));
const ANAK = "U0CFRUV378D";
const ALLOW = [ANAK];
const HEAD = "c".repeat(40);
const TOR_MERGE = "a".repeat(40);
const SRS_MERGE = "b".repeat(40);
const BRANCH_SHA = "d".repeat(40);
const PULL_SHA = "e".repeat(40);
const COMMIT_SHA = "f".repeat(40);
const PROJECT = "p1-new-format";
const YAML_PATH = `projects/${PROJECT}/project.yaml`;
const TOR_PATH = `projects/${PROJECT}/docs/tor.md`;
const SRS_PATH = `projects/${PROJECT}/docs/srs.md`;

test("loader reads at a branch, a pull request head, and a commit", async () => {
  const { client } = repoClient({
    branches: { "tor/p1-new-format/stamp": BRANCH_SHA, main: HEAD },
    pulls: { 8: { headSha: PULL_SHA } },
    filesBySha: {
      [BRANCH_SHA]: filesFor("from-branch"),
      [PULL_SHA]: filesFor("from-pull"),
      [COMMIT_SHA]: filesFor("from-commit"),
    },
  });
  const branch = await loadProjectFiles(client, {
    projectId: PROJECT,
    ref: "tor/p1-new-format/stamp",
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  const pull = await loadProjectFiles(client, {
    projectId: PROJECT,
    ref: "pull/8",
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  const commit = await loadProjectFiles(client, {
    projectId: PROJECT,
    ref: COMMIT_SHA,
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(branch.stop, false, branch.reason);
  assert.equal(branch.files[TOR_PATH], "from-branch\n");
  assert.equal(pull.stop, false, pull.reason);
  assert.equal(pull.sha, PULL_SHA);
  assert.equal(pull.files[TOR_PATH], "from-pull\n");
  assert.equal(commit.stop, false, commit.reason);
  assert.equal(commit.sha, COMMIT_SHA);
  assert.equal(commit.files[TOR_PATH], "from-commit\n");
  assert.equal(classifyRef("pull/0").ok, false);
  assert.equal(classifyRef("../main").ok, false);
});

test("loader authorizes before any fetch", async () => {
  const blocked = repoClient({ branches: { main: HEAD }, filesBySha: { [HEAD]: filesFor("hidden") } });
  const actor = await loadProjectFiles(blocked.client, {
    projectId: PROJECT,
    ref: "main",
    userId: "UOTHER",
    allowedUserIds: ALLOW,
  });
  assert.equal(actor.denied, true);
  assert.equal(actor.fetch, false);
  assert.equal(blocked.calls.length, 0);

  const project = repoClient({
    branches: { main: HEAD },
    filesBySha: { [HEAD]: filesFor("visible", { users: ["UOTHER"] }) },
  });
  const denied = await loadProjectFiles(project.client, {
    projectId: PROJECT,
    ref: "main",
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(denied.denied, true);
  assert.match(denied.reason, /not authorized for this project/);
  assert.equal(project.calls.some((call) => call.path.includes("/git/trees/")), false);
  assert.equal(project.calls.some((call) => call.path.includes("/docs/tor.md")), false);
});

test("approved TOR loads only when the sha256 matches at the merge commit and at HEAD", async () => {
  const tor = await read("fixtures/test/p1-new-format/docs/tor.md");
  const srs = await read("fixtures/test/p1-new-format/docs/srs.md");
  const yaml = await read("fixtures/test/p1-new-format/project.yaml");
  assert.equal(sha256Bytes(tor), "35121d55f8985c22d355e53725154c5513d775b112f35b098b8f800c9d33457e");
  const { client } = repoClient({
    branches: { main: HEAD },
    filesBySha: {
      [HEAD]: {
        [YAML_PATH]: yaml,
        [TOR_PATH]: tor,
        [SRS_PATH]: srs,
      },
      [TOR_MERGE]: { [TOR_PATH]: tor },
      [SRS_MERGE]: { [SRS_PATH]: srs },
    },
  });
  const loaded = await loadApprovedTor(client, { projectId: PROJECT, userId: ANAK, allowedUserIds: ALLOW });
  assert.equal(loaded.stop, false, loaded.reason);
  assert.equal(loaded.documentText, tor.toString("utf8"));
  assert.equal(loaded.sha256, sha256Bytes(tor));
  assert.equal(loaded.mergeCommit, TOR_MERGE);

  const sources = await loadChangeControlSources(client, {
    projectId: PROJECT,
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(sources.stop, false, sources.reason);
  assert.equal(sources.torSha256, sha256Bytes(tor));
  assert.equal(sources.srsSha256, sha256Bytes(srs));
  assert.match(sources.srsText, /SRS fixture/);
});

test("hash mismatch returns stop", async () => {
  const tor = await read("fixtures/test/p1-new-format/docs/tor.md");
  const yaml = await read("fixtures/test/p1-new-format/project.yaml");
  const tampered = Buffer.from(`${tor.toString("utf8")}tampered\n`);
  const head = repoClient({
    branches: { main: HEAD },
    filesBySha: {
      [HEAD]: { [YAML_PATH]: yaml, [TOR_PATH]: tampered },
      [TOR_MERGE]: { [TOR_PATH]: tor },
    },
  });
  const atHead = await loadApprovedTor(head.client, { projectId: PROJECT, userId: ANAK, allowedUserIds: ALLOW });
  assert.equal(atHead.stop, true);
  assert.equal(atHead.reason, "tor-hash-mismatch");
  assert.deepEqual(atHead.files, {});

  const merge = repoClient({
    branches: { main: HEAD },
    filesBySha: {
      [HEAD]: { [YAML_PATH]: yaml, [TOR_PATH]: tor },
      [TOR_MERGE]: { [TOR_PATH]: tampered },
    },
  });
  const atMerge = await loadApprovedTor(merge.client, { projectId: PROJECT, userId: ANAK, allowedUserIds: ALLOW });
  assert.equal(atMerge.reason, "tor-hash-mismatch");
});

test("old-format project.yaml (task-tracker-lite) is refused", async () => {
  const yaml = await read("projects/task-tracker-lite/project.yaml");
  const sha = "a".repeat(40);
  const { client, calls } = repoClient({
    branches: { main: sha },
    filesBySha: {
      [sha]: {
        "projects/task-tracker-lite/project.yaml": yaml,
        "projects/task-tracker-lite/docs/tor.md": Buffer.from("should not be read\n"),
      },
    },
  });
  const loaded = await loadProjectFiles(client, {
    projectId: "task-tracker-lite",
    ref: "main",
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(loaded.stop, true);
  assert.equal(loaded.reason, "old-format");
  assert.equal(loaded.fetch, false);
  assert.equal(calls.some((call) => call.path.includes("/git/trees/")), false);
  assert.equal(calls.some((call) => call.path.endsWith("/docs/tor.md")), false);
  const approved = await loadApprovedTor(client, {
    projectId: "task-tracker-lite",
    userId: ANAK,
    allowedUserIds: ALLOW,
    headRef: "main",
  });
  assert.equal(approved.reason, "old-format");
  const change = await loadChangeControlSources(client, {
    projectId: "task-tracker-lite",
    userId: ANAK,
    allowedUserIds: ALLOW,
    headRef: "main",
  });
  assert.equal(change.reason, "old-format");
});

test("a path outside the project stops the load", async () => {
  const { client } = repoClient({
    branches: { main: HEAD },
    filesBySha: {
      [HEAD]: {
        ...filesFor("kept"),
        "projects/p1-new-format/../../secrets.txt": "secret",
      },
    },
  });
  const loaded = await loadProjectFiles(client, {
    projectId: PROJECT,
    ref: "main",
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(loaded.reason, "path-refused");
  assert.equal(JSON.stringify(loaded).includes("secret"), false);
});

test("an unapproved or rejected TOR stops without throwing", async () => {
  const none = repoClient({
    branches: { main: HEAD },
    filesBySha: { [HEAD]: filesFor("draft", { status: "none" }) },
  });
  const notApproved = await loadApprovedTor(none.client, {
    projectId: PROJECT,
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(notApproved.reason, "tor-not-approved");
  const rejected = repoClient({
    branches: { main: HEAD },
    filesBySha: { [HEAD]: filesFor("nope", { status: "rejected" }) },
  });
  const stopped = await loadApprovedTor(rejected.client, {
    projectId: PROJECT,
    userId: ANAK,
    allowedUserIds: ALLOW,
  });
  assert.equal(stopped.reason, "tor-rejected");
});

test("fixture ids include p1", () => {
  const accepted = resolveStageInput({ fixtureId: "p1-new-format", previousBaselineApproved: false });
  assert.equal(accepted.kind, "fixture");
  assert.equal(accepted.root, "fixtures/test/p1-new-format");
  assert.throws(() => resolveStageInput({ fixtureId: "p7-no", previousBaselineApproved: false }), /p1-example/);
});

function filesFor(torText, { status = "none", users = [ANAK] } = {}) {
  return {
    [YAML_PATH]: `id: ${PROJECT}
title: New format fixture
status: active
tor:
  path: docs/tor.md
  status: ${status}
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
authorization:
  allowedSlackUserIds:
${users.map((id) => `    - ${id}`).join("\n")}
`,
    [TOR_PATH]: `${torText}\n`,
  };
}

function repoClient({ defaultBranch = "main", branches = {}, pulls = {}, filesBySha = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    calls.push({ method, path: pathname, ref: parsed.searchParams.get("ref") });
    if (method === "GET" && pathname === "/repos/o/r") return http({ default_branch: defaultBranch });
    if (method === "GET" && pathname.startsWith("/repos/o/r/git/ref/heads/")) {
      const branch = decodeURIComponent(pathname.slice("/repos/o/r/git/ref/heads/".length));
      const sha = branches[branch];
      if (!sha) return http({ message: "Not Found" }, 404);
      return http({ object: { sha } });
    }
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      const number = Number(pathname.split("/").pop());
      const pull = pulls[number];
      if (!pull) return http({ message: "Not Found" }, 404);
      return http({ number, head: { sha: pull.headSha, ref: pull.headRef ?? "main" } });
    }
    if (method === "GET" && pathname.includes("/git/trees/")) {
      const sha = pathname.split("/git/trees/")[1];
      const files = filesBySha[sha];
      if (!files) return http({ message: "Not Found" }, 404);
      return http({
        truncated: false,
        tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: "blob" })),
      });
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      const files = filesBySha[ref];
      const text = files?.[filePath];
      if (text == null) return http({ message: "Not Found" }, 404);
      const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
      return http({ encoding: "base64", content: bytes.toString("base64"), type: "file", sha: "file-sha" });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
  return { client, calls };
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
