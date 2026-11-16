import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sourceBranchMatches } from "../lib/baseline.mjs";
import { changePullRequestCard } from "../lib/change-review.mjs";
import { buildDecision, renderDecisionComment } from "../lib/gate-decision.mjs";
import { GithubClient, recordApprovedBaseline } from "../lib/github.mjs";
import { parseSimpleYaml } from "../lib/project-yaml.mjs";
import { renderStarterProjectYaml } from "../lib/project-setup.mjs";
import { IDENTITY, pullFixture } from "./gate-harness.mjs";

const ANAK = "U0CFRUV378D";
const SECRET = "test-signing-secret";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const STAMP = "20261116T030000Z";
const SRS = "approved srs bytes\n";

test("a change branch can record an SRS baseline and a baseline branch cannot", () => {
  assert.equal(sourceBranchMatches("srs", "demo", "change/demo/20261116T030000Z"), true);
  assert.equal(sourceBranchMatches("srs", "demo", "change/demo/baseline/20261116T030000Z"), false);
  assert.equal(sourceBranchMatches("srs", "demo", "spec/demo/srs/stamp"), true);
  assert.equal(sourceBranchMatches("srs", "demo", "spec/demo/srs-baseline/stamp"), false);
});

test("change recording uses the verified decision and does not auto-merge", async () => {
  const source = await readFile(new URL("../agents/change-control/agent/tools/record_change_baseline.ts", import.meta.url), "utf8");
  assert.equal(source.includes("approvedBy:"), false);
  assert.equal(source.includes("mergeRecordingPullRequest"), false);
  assert.match(source, /recordApprovedBaseline/);
  const missing = recordingClient({ comments: [] });
  await assert.rejects(
    () => recordApprovedBaseline(missing.client, recordInput()),
    /refusing to record a baseline without a verified approval/,
  );
  const wrongHead = recordingClient({
    comments: [decisionComment("d".repeat(40))],
  });
  await assert.rejects(
    () => recordApprovedBaseline(wrongHead.client, recordInput()),
    /verified approval|different pull request|head SHA/,
  );
  const harness = recordingClient({ comments: [decisionComment(HEAD)] });
  const opened = await recordApprovedBaseline(harness.client, recordInput());
  assert.equal(harness.state.merges.length, 0);
  const yaml = parseSimpleYaml(harness.state.blobs.at(-1).content);
  assert.equal(yaml.srs.status, "approved");
  assert.equal(yaml.srs.baseline.approvedAt, "2026-11-16T03:00:00.000Z");
  assert.equal(yaml.srs.baseline.approvedBy, `slack:T0TEAM:${ANAK}`);
  assert.equal(yaml.srs.baseline.sha256, opened.sha256);
  const card = changePullRequestCard({ projectId: "demo", repo: "o/r", pr: 12, headSha: HEAD });
  assert.match(card.text, /Gate srs/);
  assert.equal(card.blocks.some((block) => block.type === "actions"), true);
});

function recordInput() {
  return {
    projectId: "demo",
    pullNumber: 12,
    block: "srs",
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  };
}

function decisionComment(headSha) {
  const decision = buildDecision({
    projectId: "demo",
    stage: "srs",
    repo: "o/r",
    pr: 12,
    headSha,
    baseSha: BASE,
    action: "approve",
    decidedBy: `slack:T0TEAM:${ANAK}`,
    decidedAt: "2026-11-16T03:00:00.000Z",
    slack: {
      channel: "C0CG6SG8PNW",
      ts: "1700000000.000100",
      permalink: null,
      verification: "hmac",
      requestTimestamp: "1700000000",
    },
    reason: null,
    humanCommits: [],
    idempotencyKey: "change-approve",
    signingSecret: SECRET,
  });
  return { id: 1, body: renderDecisionComment(decision, IDENTITY.label), user: { login: IDENTITY.botLogin } };
}

function recordingClient({ comments }) {
  const yaml = renderStarterProjectYaml({
    id: "demo",
    title: "Demo",
    uploader: `slack:T0TEAM:${ANAK}`,
    uploadedAt: "2026-11-16T03:00:00.000Z",
    slackFileId: "F1",
    sourceSha256: "ab".repeat(32),
    mediaType: "text/markdown",
  });
  const state = { merges: [], blobs: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT" && pathname.endsWith("/merge")) {
      state.merges.push(body);
      return http({ merged: true, sha: MERGE });
    }
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) return http(comments);
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      return http(pullFixture({
        number: 12,
        headSha: HEAD,
        baseSha: BASE,
        state: "closed",
        merged: true,
        mergeCommitSha: MERGE,
        headRef: `change/demo/${STAMP}`,
      }));
    }
    if (method === "GET" && pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      const text = filePath.endsWith("project.yaml") && ref === "main"
        ? yaml
        : filePath.endsWith("docs/srs.md") && ref === MERGE
          ? SRS
          : null;
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file", sha: "sha-file" });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/main")) return http({ object: { sha: BASE } });
    if (method === "GET" && pathname.includes("/git/ref/heads/")) return http({ message: "Not Found" }, 404);
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: BASE, tree: { sha: "tree-base" } });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) {
      state.blobs.push(body);
      return http({ sha: "blob-1" });
    }
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
