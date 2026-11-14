import assert from "node:assert/strict";
import test from "node:test";
import {
  markProjectRejected,
  recordBaseline,
  recordingBranchName,
  sourceBranchMatches,
} from "../lib/baseline.mjs";
import { buildDecision, renderDecisionComment, verifyGateDecision } from "../lib/gate-decision.mjs";
import { GithubClient, openBaselinePullRequest, recordApprovedBaseline } from "../lib/github.mjs";
import { parseSimpleYaml } from "../lib/project-yaml.mjs";
import {
  changedYamlPaths,
  evaluateRecordingPullRequest,
  parseRecordingReference,
  recordingYamlIssue,
} from "../lib/recording-pr.mjs";
import { IDENTITY, pullFixture } from "./gate-harness.mjs";

const SECRET = "test-signing-secret";
const ANAK = "U0CFRUV378D";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const STAMP = "20261114T080000Z";
const ACTOR = `slack:T0TEAM:${ANAK}`;

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

test("recordBaseline writes the recording fields for tor, srs, and architecture", () => {
  const cases = [
    ["tor", { sha256: "ab".repeat(32) }, `tor/demo/baseline/${STAMP}`],
    ["srs", { sha256: "cd".repeat(32), sourceTorCommit: MERGE }, `spec/demo/srs-baseline/${STAMP}`],
    ["architecture", { sha256: "ef".repeat(32), sourceSrsCommit: MERGE }, `arch/demo/baseline/${STAMP}`],
  ];
  for (const [block, extra, branch] of cases) {
    const yaml = recordBaseline(before, block, {
      pullNumber: 12,
      mergeCommit: MERGE,
      approvedBy: ACTOR,
      approvedAt: "2026-11-14T08:00:00.000Z",
      extra,
    });
    const parsed = parseSimpleYaml(yaml);
    assert.equal(parsed[block].status, "approved");
    assert.equal(parsed[block].pullRequest, 12);
    assert.equal(parsed[block].baseline.mergeCommit, MERGE);
    assert.equal(parsed[block].baseline.approvedBy, ACTOR);
    assert.equal(parsed[block].baseline.approvedAt, "2026-11-14T08:00:00.000Z");
    assert.equal(parsed[block].baseline.sha256, extra.sha256);
    if (extra.sourceTorCommit) assert.equal(parsed[block].baseline.sourceTorCommit, extra.sourceTorCommit);
    if (extra.sourceSrsCommit) assert.equal(parsed[block].baseline.sourceSrsCommit, extra.sourceSrsCommit);
    assert.equal(recordingYamlIssue(yaml), null);
    const paths = changedYamlPaths(parseSimpleYaml(before), parsed);
    assert.ok(paths.every((path) => path.startsWith(`${block}.`)), paths.join(","));
    assert.equal(recordingBranchName(block, "demo", STAMP), branch);
  }
  const digitCommit = "1".repeat(40);
  const quoted = recordBaseline(before, "tor", {
    pullNumber: 12,
    mergeCommit: digitCommit,
    approvedBy: ACTOR,
    approvedAt: "2026-11-14T08:00:00.000Z",
    extra: { sha256: "ab".repeat(32) },
  });
  assert.equal(parseSimpleYaml(quoted).tor.baseline.mergeCommit, digitCommit);
  assert.equal(recordingYamlIssue(quoted), null);
  assert.equal(parseSimpleYaml(markProjectRejected(before)).status, "rejected");
  assert.equal(sourceBranchMatches("tor", "demo", "tor/demo/stamp"), true);
  assert.equal(sourceBranchMatches("tor", "demo", "tor/demo/baseline/stamp"), false);
  assert.equal(sourceBranchMatches("srs", "demo", "spec/demo/srs/stamp"), true);
  assert.equal(sourceBranchMatches("srs", "demo", "spec/demo/srs-baseline/stamp"), false);
  assert.equal(sourceBranchMatches("architecture", "demo", "change/demo/stamp"), false);
});

test("baseline PR refuses a merge commit from a foreign branch", async () => {
  const client = {
    owner: "o",
    repo: "r",
    async request() {
      throw new Error("fetched");
    },
  };
  await assert.rejects(
    () => openBaselinePullRequest(client, baselineInput({ headRef: "change/demo/stamp" })),
    /foreign branch/,
  );
  const harness = recordingClient({
    headRef: "change/demo/stamp",
    files: { "projects/demo/project.yaml": before, "projects/demo/docs/tor.md": "approved tor\n" },
  });
  await assert.rejects(
    () => recordApprovedBaseline(harness.client, recordInput("tor")),
    /foreign branch/,
  );
  assert.equal(harness.state.pulls.length, 0);
});

test("recording pull requests satisfy the auto-merge diff for tor, srs, and architecture", async () => {
  const docs = {
    tor: { headRef: "tor/demo/stamp", path: "projects/demo/docs/tor.md", text: "approved tor\n" },
    srs: { headRef: "spec/demo/srs/stamp", path: "projects/demo/docs/srs.md", text: "approved srs\n" },
    architecture: { headRef: "arch/demo/stamp", path: "projects/demo/docs/architecture.md", text: "approved architecture\n" },
  };
  for (const [block, doc] of Object.entries(docs)) {
    const harness = recordingClient({
      headRef: doc.headRef,
      files: { "projects/demo/project.yaml": before, [doc.path]: doc.text },
    });
    const opened = await recordApprovedBaseline(harness.client, {
      ...recordInput(block),
      approvedBy: "attacker",
    });
    assert.equal(opened.branch, recordingBranchName(block, "demo", STAMP));
    assert.equal(opened.approvedBy, ACTOR);
    assert.equal(opened.projectYaml.includes("attacker"), false);
    const reference = parseRecordingReference(harness.state.pulls[0].body);
    assert.equal(reference.sourcePr, 12);
    assert.equal(reference.sourceHeadSha, HEAD);
    assert.equal(reference.sourceMergeSha, MERGE);
    assert.equal(reference.document, block);
    const evaluated = evaluateRecordingPullRequest({
      files: [{ path: "projects/demo/project.yaml", status: "modified" }],
      reference,
      approval: approvalFor(block),
      sourcePull: { repo: "o/r", number: 12, headSha: HEAD, merged: true, mergeCommitSha: MERGE },
      beforeYaml: parseSimpleYaml(before),
      afterYaml: parseSimpleYaml(opened.projectYaml),
      beforeText: before,
      afterText: opened.projectYaml,
    });
    assert.equal(evaluated.ok, true, evaluated.reason);
    assert.equal(harness.state.blobs[0], opened.projectYaml);
  }
});

test("a recording baseline is refused without the gate decision or on the retired format", async () => {
  const missing = recordingClient({
    headRef: "tor/demo/stamp",
    comments: [],
    files: { "projects/demo/project.yaml": before, "projects/demo/docs/tor.md": "approved tor\n" },
  });
  await assert.rejects(() => recordApprovedBaseline(missing.client, recordInput("tor")), /verified approval/);
  assert.equal(missing.state.pulls.length, 0);

  const retired = `id: demo
title: Demo
status: active
tor:
  path: docs/tor.md
  baselineId: TOR-001
  status: frozen
  gitCommit: ${"a".repeat(40)}
  sha256: ${"ab".repeat(32)}
authorization:
  allowedSlackUserIds:
    - U0CFRUV378D
`;
  const old = recordingClient({
    headRef: "tor/demo/stamp",
    files: { "projects/demo/project.yaml": retired, "projects/demo/docs/tor.md": "approved tor\n" },
  });
  await assert.rejects(() => recordApprovedBaseline(old.client, recordInput("tor")), /old-format/);
  assert.equal(old.state.pulls.length, 0);
});

function baselineInput(overrides = {}) {
  return {
    projectId: "demo",
    block: "tor",
    baseBranch: "main",
    stamp: STAMP,
    merged: true,
    mergeCommitSha: MERGE,
    headRef: "tor/demo/stamp",
    sourcePr: 12,
    sourceHeadSha: HEAD,
    projectYamlPath: "projects/demo/project.yaml",
    projectYaml: before,
    ...overrides,
  };
}

function recordInput(block) {
  return {
    projectId: "demo",
    block,
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  };
}

function approvalFor(block) {
  const comment = decisionComment(block);
  const verified = verifyGateDecision({
    comment: { body: comment.body, authorLogin: comment.login },
    expectedAuthorLogin: IDENTITY.botLogin,
    repo: "o/r",
    pullNumber: 12,
    liveHeadSha: HEAD,
    allowedUserIds: [ANAK],
    projectId: "demo",
    signingSecret: SECRET,
    requireCi: false,
  });
  assert.equal(verified.ok, true, verified.reason);
  return verified.verified;
}

function decisionComment(block) {
  const decision = buildDecision({
    projectId: "demo",
    stage: block,
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: BASE,
    action: "approve",
    decidedBy: ACTOR,
    decidedAt: "2026-11-14T08:00:00.000Z",
    slack: {
      channel: "C0CG6SG8PNW",
      ts: "1700000000.000100",
      permalink: null,
      verification: "hmac",
      requestTimestamp: "1700000000",
    },
    reason: null,
    humanCommits: [],
    idempotencyKey: `approved-${block}`,
    signingSecret: SECRET,
  });
  return { body: renderDecisionComment(decision, IDENTITY.label), login: IDENTITY.botLogin };
}

function recordingClient({ headRef, files, comments }) {
  const comment = decisionComment("tor");
  const issueComments = comments ?? [{ id: 1, body: comment.body, user: { login: comment.login } }];
  const pull = pullFixture({
    number: 12,
    headSha: HEAD,
    baseSha: BASE,
    state: "closed",
    merged: true,
    mergeCommitSha: MERGE,
    headRef,
  });
  const state = { blobs: [], pulls: [], branches: {} };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: pathname, body });
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) return http(issueComments);
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) return http(pull);
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const text = files[filePath];
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
        type: "file",
        sha: `sha-${filePath.length}`,
      });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/ref/heads/")[1]);
      if (name === "main") return http({ object: { sha: BASE } });
      if (!state.branches[name]) return http({ message: "Not Found" }, 404);
      return http({ object: { sha: state.branches[name] } });
    }
    if (method === "GET" && pathname.includes("/git/commits/")) {
      return http({ sha: BASE, tree: { sha: "tree-base" } });
    }
    if (method === "POST" && pathname.endsWith("/git/refs")) {
      const name = body.ref.replace(/^refs\/heads\//, "");
      state.branches[name] = body.sha;
      return http({ ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "POST" && pathname.endsWith("/git/blobs")) {
      state.blobs.push(body.content);
      return http({ sha: "blob-1" });
    }
    if (method === "POST" && pathname.endsWith("/git/trees")) return http({ sha: "tree-new" });
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "d".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/refs/heads/")[1]);
      state.branches[name] = body.sha;
      return http({ ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    if (method === "POST" && pathname.endsWith("/pulls")) {
      state.pulls.push(body);
      return http({ html_url: "https://github.com/o/r/pull/13", number: 13, head: { sha: "d".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({
    fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
    identity: IDENTITY,
  });
  return { client, state, calls };
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
