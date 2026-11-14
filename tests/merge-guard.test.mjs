import assert from "node:assert/strict";
import test from "node:test";
import { buildDecision, renderDecisionComment, verifyGateDecision } from "../lib/gate-decision.mjs";
import { MERGE_REFUSED, githubRepoFromEnv, mergeApprovedPullRequest } from "../lib/github.mjs";
import { IDENTITY, gateGithub, pullFixture } from "./gate-harness.mjs";

const SECRET = "test-signing-secret";
const HEAD = "a".repeat(40);
const MOVED = "b".repeat(40);
const BASE = "c".repeat(40);
const ANAK = "U0CFRUV378D";

test("GITHUB_REPOSITORY is required and does not guess a repository", () => {
  assert.throws(() => githubRepoFromEnv({}), /GITHUB_REPOSITORY is required/);
  assert.throws(() => githubRepoFromEnv({ GITHUB_REPOSITORY: "" }), /GITHUB_REPOSITORY is required/);
  assert.throws(() => githubRepoFromEnv({ GITHUB_REPOSITORY: "owner/repo/extra" }), /must be owner\/repo/);
  assert.deepEqual(githubRepoFromEnv({ GITHUB_REPOSITORY: "Awannaphasch2016/org-brain" }), {
    owner: "Awannaphasch2016",
    repo: "org-brain",
  });
});

test("merge is refused without a decision", async () => {
  const harness = harnessFor();
  await assert.rejects(() => merge(harness), new RegExp(MERGE_REFUSED));
  assert.equal(harness.state.merges.length, 0);
});

test("merge is refused when the head SHA moved after approval", async () => {
  const harness = harnessFor({ headSha: MOVED, comment: decisionComment() });
  await assert.rejects(() => merge(harness), /head SHA moved after approval/);
  assert.equal(harness.state.merges.length, 0);
});

test("merge is refused for a decision comment not authored by the bot", async () => {
  const harness = harnessFor({ comment: decisionComment({ login: "Awannaphasch2016" }) });
  await assert.rejects(() => merge(harness), /not authored by the gate identity/);
  assert.equal(harness.state.merges.length, 0);
});

test("merge is refused for a non-allowlisted decider and for the wrong project", async () => {
  const outsider = harnessFor({
    comment: decisionComment({ decidedBy: "slack:T0TEAM:UOUTSIDER" }),
  });
  await assert.rejects(() => merge(outsider), /not on the allowlist/);
  const wrongProject = harnessFor({ comment: decisionComment({ projectId: "other-project" }) });
  await assert.rejects(() => merge(wrongProject), /wrong project/);
});

test("merge is refused when required CI is not green", async () => {
  const failing = harnessFor({
    comment: decisionComment(),
    checks: { [HEAD]: [{ name: "check", status: "completed", conclusion: "failure" }] },
  });
  await assert.rejects(() => merge(failing), /required CI is not green/);
  const otherName = harnessFor({
    comment: decisionComment(),
    checks: { [HEAD]: [{ name: "build", status: "completed", conclusion: "success" }] },
  });
  await assert.rejects(() => merge(otherName), /required CI is not green/);
  const pending = harnessFor({
    comment: decisionComment(),
    checks: {
      [HEAD]: [
        { name: "check", status: "completed", conclusion: "success" },
        { name: "lint", status: "in_progress", conclusion: null },
      ],
    },
  });
  await assert.rejects(() => merge(pending), /required CI is not green/);
  assert.equal(failing.state.merges.length, 0);
});

test("merge re-reads the head immediately before the GitHub sha parameter", async () => {
  const harness = harnessFor({
    comment: decisionComment(),
    headOnRead: ({ number, read }) => (number === 12 && read >= 2 ? MOVED : null),
  });
  await assert.rejects(() => merge(harness), /head SHA moved before merge/);
  assert.equal(harness.state.merges.length, 0);
});

test("a plain object cannot authorize a merge, and a seal does not cover another repository", async () => {
  const harness = harnessFor({ comment: decisionComment() });
  await assert.rejects(
    () => harness.client.request("PUT", "/repos/o/r/pulls/12/merge", {
      body: { sha: HEAD, merge_method: "merge" },
      mergeAuthorization: { kind: "gate", repo: "o/r", pr: 12, headSha: HEAD },
    }),
    new RegExp(MERGE_REFUSED),
  );
  const verified = verifyGateDecision({
    comment: { body: decisionComment().body, authorLogin: IDENTITY.botLogin },
    expectedAuthorLogin: IDENTITY.botLogin,
    repo: "o/r",
    pullNumber: 12,
    liveHeadSha: HEAD,
    allowedUserIds: [ANAK],
    projectId: "demo",
    signingSecret: SECRET,
    requireCi: false,
  });
  assert.equal(verified.ok, true);
  await assert.rejects(
    () => harness.client.request("PUT", "/repos/other/repo/pulls/12/merge", {
      body: { sha: HEAD, merge_method: "merge" },
      mergeAuthorization: verified.authorization,
    }),
    /different repository/,
  );
});

test("merge sends sha=headSha and merge_method=merge for a verified decision", async () => {
  const harness = harnessFor({ comment: decisionComment() });
  await merge(harness);
  assert.equal(harness.state.merges.length, 1);
  assert.equal(harness.state.merges[0].body.sha, HEAD);
  assert.equal(harness.state.merges[0].body.merge_method, "merge");
  assert.match(harness.state.merges[0].body.commit_message, /GitHub identity: github-app \(factory\[bot\]\)/);
});

test("a decision that only claims approval in text is refused when the signature binding does not match", async () => {
  const claimed = buildDecision({
    projectId: "demo",
    stage: "tor",
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: BASE,
    action: "approve",
    decidedBy: `slack:T0TEAM:${ANAK}`,
    decidedAt: "2026-11-14T08:00:00.000Z",
    slack: { channel: "C0CG6SG8PNW", ts: "1.2", permalink: null, verification: "hmac", requestTimestamp: "1" },
    reason: null,
    humanCommits: [],
    idempotencyKey: "claimed",
    signingSecret: "someone-elses-secret",
  });
  const harness = harnessFor({ comment: { body: renderDecisionComment(claimed, IDENTITY.label), login: IDENTITY.botLogin } });
  await assert.rejects(() => merge(harness), /not bound to the signed Slack event/);
});

function merge(harness) {
  return mergeApprovedPullRequest(harness.client, {
    pullNumber: 12,
    projectId: "demo",
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    env: { FACTORY_REQUIRED_CHECK: "check" },
  });
}

function harnessFor({ headSha = HEAD, comment = null, checks, headOnRead } = {}) {
  return gateGithub({
    pulls: { 12: pullFixture({ number: 12, headSha, baseSha: BASE }) },
    comments: comment ? { 12: [{ id: 1, body: comment.body, user: { login: comment.login } }] } : {},
    checks,
    headOnRead,
  });
}

function decisionComment(overrides = {}) {
  const decision = buildDecision({
    projectId: overrides.projectId ?? "demo",
    stage: "tor",
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: BASE,
    action: "approve",
    decidedBy: overrides.decidedBy ?? `slack:T0TEAM:${ANAK}`,
    decidedAt: "2026-11-14T08:00:00.000Z",
    slack: { channel: "C0CG6SG8PNW", ts: "1700000000.000100", permalink: null, verification: "hmac", requestTimestamp: "1700000000" },
    reason: null,
    humanCommits: [],
    idempotencyKey: "decision-key",
    signingSecret: SECRET,
  });
  return { body: renderDecisionComment(decision, IDENTITY.label), login: overrides.login ?? IDENTITY.botLogin };
}
