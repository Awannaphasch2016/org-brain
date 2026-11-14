import { createHmac, timingSafeEqual } from "node:crypto";
import { markVerifiedDecision, sealMergeAuthorization } from "./merge-auth.mjs";

export const DECISION_SCHEMA = 1;
export const DECISION_KIND = "factory-gate-decision";
export const PENDING_KIND = "factory-gate-pending";
export const REASON_PROMPT = "Reply in this thread with the reason or comments";

const SHA = /^[0-9a-f]{40}$/i;
const SLACK_USER = /^U[A-Z0-9]+$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

export function gateIdempotencyKey({ repo, pr, teamId, channel, messageTs, userId, action, headSha }) {
  return [repo, pr, teamId, channel, messageTs, userId, action, headSha].join(":");
}

export function decisionMac(decision, signingSecret) {
  const material = [
    String(decision.schema),
    decision.kind,
    decision.repo,
    String(decision.pr),
    decision.headSha,
    decision.baseSha ?? "",
    decision.action,
    decision.decidedBy,
    decision.projectId,
    decision.stage,
    decision.slack.ts,
    decision.slack.requestTimestamp,
    decision.idempotencyKey,
    decision.reason ?? "",
    (decision.humanCommits ?? []).join(","),
  ].join("\n");
  return createHmac("sha256", signingSecret).update(material).digest("hex");
}

export function buildDecision(input) {
  const decision = {
    schema: DECISION_SCHEMA,
    kind: DECISION_KIND,
    projectId: input.projectId,
    stage: input.stage,
    repo: input.repo,
    pr: input.pr,
    headSha: input.headSha,
    baseSha: input.baseSha ?? null,
    action: input.action,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    slack: {
      channel: input.slack.channel,
      ts: input.slack.ts,
      permalink: input.slack.permalink ?? null,
      signatureVerified: true,
      verification: input.slack.verification,
      requestTimestamp: input.slack.requestTimestamp,
    },
    reason: input.reason ?? null,
    humanCommits: input.humanCommits ?? [],
    idempotencyKey: input.idempotencyKey,
  };
  if (input.signingSecret) {
    decision.slack.mac = decisionMac(decision, input.signingSecret);
  }
  return decision;
}

export function renderDecisionComment(decision, identityLabel) {
  return [
    "Factory gate decision. A comment counts only when its GitHub author is the gate identity and the signed Slack check inside the record passes.",
    identityLabel ? `GitHub identity: ${identityLabel}` : null,
    "",
    "<!-- factory-gate-decision v1 -->",
    "```json",
    JSON.stringify(decision, null, 2),
    "```",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildPending(input) {
  return {
    schema: DECISION_SCHEMA,
    kind: PENDING_KIND,
    projectId: input.projectId,
    stage: input.stage,
    repo: input.repo,
    pr: input.pr,
    headSha: input.headSha,
    action: input.action,
    requestedBy: input.requestedBy,
    idempotencyKey: input.idempotencyKey,
    slack: {
      channel: input.slack.channel,
      threadTs: input.slack.threadTs ?? null,
      messageTs: input.slack.messageTs,
    },
  };
}

export function renderPendingComment(pending, identityLabel) {
  return [
    REASON_PROMPT,
    identityLabel ? `GitHub identity: ${identityLabel}` : null,
    "",
    "<!-- factory-gate-pending v1 -->",
    "```json",
    JSON.stringify(pending, null, 2),
    "```",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function parseFencedRecord(body, kind) {
  if (typeof body !== "string" || !body.includes(`"kind"`)) return null;
  const fences = body.matchAll(/```json\s*([\s\S]*?)```/g);
  for (const fence of fences) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (parsed && parsed.kind === kind) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export function parseDecisionComment(body) {
  const parsed = parseFencedRecord(body, DECISION_KIND);
  if (!parsed) return { ok: false, reason: "decision record is missing" };
  if (parsed.schema !== DECISION_SCHEMA) return { ok: false, reason: "unknown schema" };
  if (typeof parsed.projectId !== "string" || !PROJECT_ID.test(parsed.projectId)) {
    return { ok: false, reason: "decision project is invalid" };
  }
  if (typeof parsed.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(parsed.repo)) {
    return { ok: false, reason: "decision repo is invalid" };
  }
  if (!Number.isInteger(parsed.pr) || parsed.pr < 1) return { ok: false, reason: "decision pull request is invalid" };
  if (typeof parsed.headSha !== "string" || !SHA.test(parsed.headSha)) {
    return { ok: false, reason: "decision head SHA is invalid" };
  }
  if (!["approve", "reject", "revise"].includes(parsed.action)) {
    return { ok: false, reason: "decision action is invalid" };
  }
  if (typeof parsed.decidedBy !== "string" || !/^slack:[^:\s]+:U[A-Z0-9]+$/.test(parsed.decidedBy)) {
    return { ok: false, reason: "decision actor is invalid" };
  }
  if (!parsed.slack || parsed.slack.signatureVerified !== true) {
    return { ok: false, reason: "slack signature was not verified" };
  }
  if (typeof parsed.idempotencyKey !== "string" || !parsed.idempotencyKey) {
    return { ok: false, reason: "decision idempotency key is missing" };
  }
  return { ok: true, decision: parsed };
}

export function slackUserIdFromDecidedBy(decidedBy) {
  const match = String(decidedBy).match(/^slack:[^:\s]+:(U[A-Z0-9]+)$/);
  return match?.[1] ?? null;
}

function macMatches(decision, signingSecret) {
  if (!signingSecret || typeof decision.slack?.mac !== "string") return false;
  const expected = decisionMac(decision, signingSecret);
  const actual = decision.slack.mac;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function verifyGateDecision({
  comment,
  expectedAuthorLogin,
  repo,
  pullNumber,
  liveHeadSha,
  allowedUserIds,
  projectId,
  signingSecret,
  requireMac = false,
  ciGreen = true,
  requireCi = true,
  expectedAction = "approve",
}) {
  if (!comment || comment.authorLogin !== expectedAuthorLogin) {
    return { ok: false, reason: "decision comment is not authored by the gate identity" };
  }
  const parsed = parseDecisionComment(comment.body);
  if (!parsed.ok) return parsed;
  const decision = parsed.decision;
  if (decision.repo !== repo) return { ok: false, reason: "wrong repo" };
  if (decision.pr !== pullNumber) return { ok: false, reason: "wrong pull request" };
  if (decision.headSha !== liveHeadSha) return { ok: false, reason: "head SHA moved after approval" };
  if (projectId && decision.projectId !== projectId) return { ok: false, reason: "wrong project" };
  if (decision.action !== expectedAction) {
    return {
      ok: false,
      reason: expectedAction === "approve" ? "decision is not an approval" : `decision is not ${expectedAction}`,
    };
  }
  const userId = slackUserIdFromDecidedBy(decision.decidedBy);
  if (!userId || !SLACK_USER.test(userId) || !Array.isArray(allowedUserIds) || !allowedUserIds.includes(userId)) {
    return { ok: false, reason: "decider is not on the allowlist" };
  }
  const verification = decision.slack.verification;
  if (verification !== "hmac" && verification !== "eve-connect") {
    return { ok: false, reason: "slack signature was not verified" };
  }
  if (verification === "eve-connect" && !String(expectedAuthorLogin).endsWith("[bot]")) {
    return { ok: false, reason: "eve-connect decisions require the GitHub App bot" };
  }
  if (requireMac || verification === "hmac") {
    if (!macMatches(decision, signingSecret)) return { ok: false, reason: "decision is not bound to the signed Slack event" };
  }
  if (requireCi && !ciGreen) return { ok: false, reason: "required CI is not green" };
  return {
    ok: true,
    decision,
    verified: markVerifiedDecision(decision),
    authorization: sealMergeAuthorization({
      kind: "gate",
      repo,
      pr: pullNumber,
      headSha: liveHeadSha,
    }),
  };
}

export function ciIsGreen({ combinedState, checkRuns, requiredCheckName = "check" }) {
  const name = typeof requiredCheckName === "string" ? requiredCheckName.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return false;
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  if (runs.length === 0) return false;
  const required = runs.filter((run) => run.name === name);
  if (required.length === 0) return false;
  const everyRunGreen = runs.every((run) => run.status === "completed" && run.conclusion === "success");
  if (!everyRunGreen) return false;
  return combinedState === "success";
}
