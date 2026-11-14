import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDecision, renderDecisionComment } from "../lib/gate-decision.mjs";
import { GithubClient } from "../lib/github.mjs";
import { loadApprovedSrs, loadApprovedTor } from "../lib/project-files.mjs";
import { setYamlPath } from "../lib/project-yaml.mjs";
import { renderHashMismatchAlert } from "../lib/slack-gate.mjs";
import { openTorDraft, recordTorBaseline } from "../lib/tor-draft.mjs";
import { IDENTITY, pullFixture } from "./gate-harness.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const ANAK = "U0CFRUV378D";
const SECRET = "test-signing-secret";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const STAMP = "20261114T100000Z";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const before = `id: demo
title: Demo
status: active
tor:
  path: docs/tor.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
srs:
  path: docs/srs.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
    sourceTorCommit: null
architecture:
  path: docs/architecture.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
    sourceSrsCommit: null
authorization:
  allowedSlackUserIds:
    - U0CFRUV378D
`;

test("record_tor_baseline hashes bytes at the merge commit, not HEAD", async () => {
  const mergeBytes = "bytes at the merge commit\n";
  const harness = recordingClient({
    headRef: "tor/demo/stamp",
    files: {
      "main:projects/demo/project.yaml": before,
      "main:projects/demo/docs/tor.md": "bytes at HEAD\n",
      [`${MERGE}:projects/demo/docs/tor.md`]: mergeBytes,
    },
  });
  const opened = await recordTorBaseline(harness.client, {
    projectId: "demo",
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  });
  assert.equal(opened.sha256, sha256(mergeBytes));
  assert.notEqual(opened.sha256, sha256("bytes at HEAD\n"));
  assert.equal(opened.branch, `tor/demo/baseline/${STAMP}`);
});

test("refuses unmerged or foreign PR", async () => {
  const unmerged = recordingClient({ headRef: "tor/demo/stamp", merged: false, files: {} });
  await assert.rejects(
    () => recordTorBaseline(unmerged.client, recordInput()),
    /not merged|before the pull request is merged/,
  );
  const foreign = recordingClient({
    headRef: "change/demo/stamp",
    files: { "main:projects/demo/project.yaml": before, [`${MERGE}:projects/demo/docs/tor.md`]: "x\n" },
  });
  await assert.rejects(() => recordTorBaseline(foreign.client, recordInput()), /foreign branch/);
});

test("revise opens a new stamped pull request and supersedes the old one", async () => {
  const harness = draftClient();
  const opened = await openTorDraft(harness.client, {
    projectId: "demo",
    stamp: STAMP,
    baseBranch: "main",
    grant: { agent: "tor", projectId: "demo", branchPrefix: "tor/demo/" },
    supersededPullNumber: 9,
    tor: await read("fixtures/test/p1-intake-complete/tor.md"),
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    elicitationLog: await read("fixtures/test/p1-intake-complete/tor-elicitation-log.md"),
    structureMarkdown: await read("knowledge/guidelines/tor-structure.md"),
    humanCommits: [
      {
        sha: "d".repeat(40),
        summary: "edit the draft",
        files: [{ filename: "projects/demo/docs/tor.md" }],
        additions: 2,
        deletions: 1,
      },
    ],
  });
  assert.equal(opened.branch, `tor/demo/${STAMP}`);
  assert.equal(harness.state.closes, 1);
  assert.equal(opened.merged, false);
  assert.match(opened.card.text, /edit the draft|Gate tor/);
  assert.match(JSON.stringify(opened.card.blocks), /edit the draft/);
  const paths = harness.state.trees[0].tree.map((entry) => entry.path).sort();
  assert.deepEqual(paths, [
    "projects/demo/docs/tor-analysis.md",
    "projects/demo/docs/tor-elicitation-log.md",
    "projects/demo/docs/tor.md",
  ]);
});

test("hash mismatch stops spec and architecture loaders and renders an alert", async () => {
  const torYaml = approvedYaml("tor");
  const tor = await loadApprovedTor(loaderClient(torYaml), {
    projectId: "demo",
    userId: ANAK,
    allowedUserIds: [ANAK],
    headRef: "main",
  });
  assert.equal(tor.stop, true);
  assert.equal(tor.reason, "tor-hash-mismatch");
  const srsYaml = approvedYaml("srs");
  const srs = await loadApprovedSrs(loaderClient(srsYaml, "srs"), {
    projectId: "demo",
    userId: ANAK,
    allowedUserIds: [ANAK],
    headRef: "main",
  });
  assert.equal(srs.stop, true);
  assert.equal(srs.reason, "srs-hash-mismatch");
  const alert = renderHashMismatchAlert({ projectId: "demo", reason: tor.reason });
  assert.equal(JSON.stringify(alert.blocks).includes('"type":"actions"'), false);
  assert.match(alert.text, /hash mismatch/);
});

function approvedYaml(block) {
  let yaml = setYamlPath(before, `${block}.status`, "approved");
  yaml = setYamlPath(yaml, `${block}.pullRequest`, 3);
  yaml = setYamlPath(yaml, `${block}.baseline.mergeCommit`, MERGE);
  return setYamlPath(yaml, `${block}.baseline.sha256`, "ab".repeat(32));
}

function recordInput() {
  return {
    projectId: "demo",
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  };
}

function decisionComment() {
  const decision = buildDecision({
    projectId: "demo",
    stage: "tor",
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: BASE,
    action: "approve",
    decidedBy: `slack:T0TEAM:${ANAK}`,
    decidedAt: "2026-11-14T10:00:00.000Z",
    slack: {
      channel: "C0CG6SG8PNW",
      ts: "1700000000.000100",
      permalink: null,
      verification: "hmac",
      requestTimestamp: "1700000000",
    },
    reason: null,
    humanCommits: [],
    idempotencyKey: "approved-tor-draft",
    signingSecret: SECRET,
  });
  return { id: 1, body: renderDecisionComment(decision, IDENTITY.label), user: { login: IDENTITY.botLogin } };
}

function recordingClient({ headRef, files, merged = true }) {
  const state = { merges: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) return http([decisionComment()]);
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      return http(pullFixture({
        number: 12,
        headSha: HEAD,
        baseSha: BASE,
        state: merged ? "closed" : "open",
        merged,
        mergeCommitSha: merged ? MERGE : null,
        headRef,
      }));
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      const text = files[`${ref}:${filePath}`];
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file", sha: "sha-file" });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/ref/heads/")[1]);
      if (name === "main") return http({ object: { sha: BASE } });
      return http({ message: "Not Found" }, 404);
    }
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: BASE, tree: { sha: "tree-base" } });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) return http({ sha: "blob-1" });
    if (method === "POST" && pathname.endsWith("/git/trees")) return http({ sha: "tree-new" });
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "e".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/15", number: 15, head: { sha: "e".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return {
    state,
    client: new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r", identity: IDENTITY }),
  };
}

function draftClient() {
  const state = { trees: [], closes: 0 };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PATCH" && /\/pulls\/\d+$/.test(pathname)) {
      state.closes += 1;
      return http({ state: "closed" });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/main")) return http({ object: { sha: BASE } });
    if (method === "GET" && pathname.includes("/git/ref/heads/")) return http({ message: "Not Found" }, 404);
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: BASE, tree: { sha: "tree-base" } });
    if (method === "GET" && pathname.includes("/contents/")) return http({ message: "Not Found" }, 404);
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) return http({ sha: "blob-1" });
    if (method === "POST" && pathname.endsWith("/git/trees")) {
      state.trees.push(body);
      return http({ sha: "tree-new" });
    }
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "e".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/16", number: 16, head: { sha: "e".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return { state, client: new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" }) };
}

function loaderClient(yaml, kind = "tor") {
  const head = "c".repeat(40);
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    if (pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (pathname.includes("/git/ref/heads/main")) return http({ object: { sha: head } });
    if (pathname.includes("/git/trees/")) {
      const doc = kind === "srs" ? "projects/demo/docs/srs.md" : "projects/demo/docs/tor.md";
      return http({
        truncated: false,
        tree: [
          { path: "projects/demo/project.yaml", type: "blob" },
          { path: doc, type: "blob" },
        ],
      });
    }
    if (pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const text = filePath.endsWith("project.yaml") ? yaml : "different bytes\n";
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file", sha: "s" });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
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
