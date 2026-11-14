import assert from "node:assert/strict";
import test from "node:test";
import { buildDecision, renderDecisionComment } from "../lib/gate-decision.mjs";
import { mergeApprovedPullRequest, mergeRecordingPullRequest } from "../lib/github.mjs";
import { parseSimpleYaml, setYamlPath } from "../lib/project-yaml.mjs";
import { evaluateRecordingPullRequest, renderRecordingReference } from "../lib/recording-pr.mjs";
import { verifyGateDecision } from "../lib/gate-decision.mjs";
import { IDENTITY, gateGithub, pullFixture } from "./gate-harness.mjs";

const SECRET = "test-signing-secret";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const RECORD_HEAD = "d".repeat(40);
const OTHER = "e".repeat(40);
const ANAK = "U0CFRUV378D";
const PATH = "projects/demo/project.yaml";

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

test("recording diff is accepted only for the approved pull request and commit", () => {
  const allowed = evaluate(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }));
  assert.equal(allowed.ok, true, allowed.reason);

  const wrongField = evaluate(setYamlPath(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }), "title", "Changed"));
  assert.equal(wrongField.reason, "wrong field");

  const extraFile = evaluate(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }), {
    files: [{ path: PATH }, { path: "projects/demo/docs/tor.md" }],
  });
  assert.equal(extraFile.reason, "extra file");

  const wrongPr = evaluate(recordYaml(before, { pullRequest: 99, mergeCommit: MERGE }), {
    reference: { ...reference(), sourcePr: 99 },
  });
  assert.equal(wrongPr.reason, "wrong PR ref");

  const wrongSha = evaluate(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }), {
    reference: { ...reference(), sourceHeadSha: OTHER },
  });
  assert.equal(wrongSha.reason, "wrong SHA");

  const missing = evaluate(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }), { approval: null });
  assert.equal(missing.reason, "missing approval");
  const claimed = evaluate(recordYaml(before, { pullRequest: 12, mergeCommit: MERGE }), {
    approval: { decision: { action: "approve", pr: 12, headSha: HEAD } },
  });
  assert.equal(claimed.reason, "missing approval");
});

test("a recording pull request auto-merges on its own path and the human gate refuses it", async () => {
  const after = recordYaml(before, { pullRequest: 12, mergeCommit: MERGE });
  const body = renderRecordingReference(reference());
  const approval = decisionComment();
  const harness = gateGithub({
    pulls: {
      12: pullFixture({ number: 12, headSha: HEAD, baseSha: BASE, state: "closed", merged: true, mergeCommitSha: MERGE }),
      13: pullFixture({ number: 13, headSha: RECORD_HEAD, baseSha: BASE, body, headRef: "tor/demo/baseline/stamp" }),
    },
    comments: { 12: [{ id: 1, body: approval.body, user: { login: approval.login } }] },
    files: { 13: [{ filename: PATH, status: "modified" }] },
    contents: { [`${BASE}:${PATH}`]: before, [`${RECORD_HEAD}:${PATH}`]: after },
  });
  await assert.rejects(
    () => mergeApprovedPullRequest(harness.client, {
      pullNumber: 13,
      projectId: "demo",
      allowedUserIds: [ANAK],
      signingSecret: SECRET,
    }),
    /no verified gate decision/,
  );
  await mergeRecordingPullRequest(harness.client, {
    pullNumber: 13,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
  });
  assert.equal(harness.state.merges.length, 1);
  assert.equal(harness.state.merges[0].number, 13);
  assert.equal(harness.state.merges[0].body.sha, RECORD_HEAD);
  assert.equal(harness.state.merges[0].body.merge_method, "merge");
  assert.equal(parseSimpleYaml(after).tor.baseline.mergeCommit, MERGE);
});

function reference(overrides = {}) {
  return {
    document: "tor",
    projectId: "demo",
    repo: "o/r",
    sourcePr: 12,
    sourceHeadSha: HEAD,
    sourceMergeSha: MERGE,
    recordingPr: 13,
    recordingHeadSha: RECORD_HEAD,
    ...overrides,
  };
}

function recordYaml(text, { pullRequest, mergeCommit }) {
  let next = setYamlPath(text, "tor.status", "approved");
  next = setYamlPath(next, "tor.pullRequest", pullRequest);
  next = setYamlPath(next, "tor.baseline.mergeCommit", mergeCommit);
  next = setYamlPath(next, "tor.baseline.approvedAt", "2026-11-14T08:00:00.000Z");
  next = setYamlPath(next, "tor.baseline.approvedBy", `slack:T0TEAM:${ANAK}`);
  return setYamlPath(next, "tor.baseline.sha256", "ab".repeat(32));
}

function approvalFor() {
  const comment = decisionComment();
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

function evaluate(after, overrides = {}) {
  return evaluateRecordingPullRequest({
    files: overrides.files ?? [{ path: PATH }],
    reference: overrides.reference === undefined ? reference() : overrides.reference,
    approval: overrides.approval === undefined ? approvalFor() : overrides.approval,
    sourcePull: overrides.sourcePull === undefined
      ? { repo: "o/r", number: 12, headSha: HEAD, merged: true, mergeCommitSha: MERGE }
      : overrides.sourcePull,
    beforeYaml: parseSimpleYaml(before),
    afterYaml: parseSimpleYaml(after),
  });
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
    decidedAt: "2026-11-14T08:00:00.000Z",
    slack: { channel: "C0CG6SG8PNW", ts: "1700000000.000100", permalink: null, verification: "hmac", requestTimestamp: "1700000000" },
    reason: null,
    humanCommits: [],
    idempotencyKey: "approved-tor",
    signingSecret: SECRET,
  });
  return { body: renderDecisionComment(decision, IDENTITY.label), login: IDENTITY.botLogin };
}
