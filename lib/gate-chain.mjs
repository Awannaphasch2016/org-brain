import { ciIsGreen } from "./gate-decision.mjs";
import { parseFencedRecord } from "./gate-decision.mjs";
import {
  commentOnPullRequest,
  getCombinedStatus,
  getPullRequestStatus,
  listIssueComments,
  mergeRecordingPullRequest,
  readRepoTextFile,
  recordApprovedBaseline,
} from "./github.mjs";
import { startFromTransition } from "./orchestrator.mjs";
import { parseSimpleYaml } from "./project-yaml.mjs";
import { RECORDING_POINTER_KIND, TRANSITION_KIND, commentsAlreadyRecorded } from "./recording-pr.mjs";

export { RECORDING_POINTER_KIND, TRANSITION_KIND };

const BLOCK_FOR_STAGE = {
  tor: "tor",
  "project-plan": "projectPlan",
  srs: "srs",
};

export function nextPhaseFor(stage) {
  if (stage === "tor") return "project-planner";
  if (stage === "project-plan") return "specification";
  if (stage === "srs") return null;
  return undefined;
}

export function stampForDecision(decision) {
  return String(decision?.decidedAt ?? "").replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fenced(kind, record) {
  return ["```json", JSON.stringify({ schema: 1, kind, ...record }, null, 2), "```", ""].join("\n");
}

export function renderTransition(event) {
  return ["Factory gate transition.", "", `<!-- ${TRANSITION_KIND} v1 -->`, fenced(TRANSITION_KIND, event)].join("\n");
}

function renderPointer(record) {
  return ["Recording pull request opened.", "", `<!-- ${RECORDING_POINTER_KIND} v1 -->`, fenced(RECORDING_POINTER_KIND, record)].join("\n");
}

function commentRecord(body, kind) {
  return parseFencedRecord(body, kind);
}

function ciConclusion(combined, requiredCheckName = "check") {
  if (ciIsGreen({ combinedState: combined.state, checkRuns: combined.checkRuns, requiredCheckName })) {
    return "success";
  }
  const run = (combined.checkRuns ?? []).find((item) => item.name === requiredCheckName);
  if (run && run.status === "completed" && run.conclusion && run.conclusion !== "success") return "failure";
  if (combined.state === "failure" || combined.state === "error") return "failure";
  return "pending";
}

export async function recordingAlreadyOpened(client, pullNumber) {
  return commentsAlreadyRecorded(await listIssueComments(client, pullNumber));
}

export function deferGateChain(waitUntil, start) {
  const work = Promise.resolve().then(start).then(() => undefined);
  waitUntil(work);
  return work;
}

export async function runApprovedGateChain(input) {
  const decision = input.decision;
  const block = BLOCK_FOR_STAGE[decision?.stage];
  const notices = [];
  if (!block || !decision) return { status: "skipped", notices, event: null };
  const client = input.client;
  const recordBaseline = input.recordBaseline ?? recordApprovedBaseline;
  const mergeRecording = input.mergeRecording ?? mergeRecordingPullRequest;
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? (() => Date.now());
  const intervalMs = input.intervalMs ?? 10_000;
  const timeoutMs = input.timeoutMs ?? 5 * 60_000;
  const comments = await listIssueComments(client, decision.pr);
  const existingTransition = comments
    .map((comment) => commentRecord(comment.body, TRANSITION_KIND))
    .find((record) => record?.idempotencyKey === decision.idempotencyKey);
  if (existingTransition) return { status: "already-transitioned", notices, event: null };
  const pointer = comments
    .map((comment) => commentRecord(comment.body, RECORDING_POINTER_KIND))
    .find((record) => record?.idempotencyKey === decision.idempotencyKey);
  let recordingNumber = pointer?.recordingPr ?? null;
  if (!recordingNumber) {
    const opened = await recordBaseline(client, {
      projectId: decision.projectId,
      pullNumber: decision.pr,
      block,
      stamp: input.stamp ?? stampForDecision(decision),
      allowedUserIds: input.allowedUserIds,
      signingSecret: input.signingSecret,
      baseBranch: input.baseBranch,
    });
    recordingNumber = opened.number;
    await commentOnPullRequest(client, decision.pr, renderPointer({
      idempotencyKey: decision.idempotencyKey,
      recordingPr: recordingNumber,
      block,
    }));
  }
  const started = now();
  let ciState = "pending";
  let merged = false;
  const steps = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let attempt = 0; attempt <= steps; attempt += 1) {
    const status = await getPullRequestStatus(client, recordingNumber);
    if (status.merged) {
      merged = true;
      ciState = "success";
      break;
    }
    const combined = await getCombinedStatus(client, status.headSha);
    ciState = ciConclusion(combined);
    if (ciState === "failure") break;
    if (ciState === "success") {
      await mergeRecording(client, {
        pullNumber: recordingNumber,
        allowedUserIds: input.allowedUserIds,
        signingSecret: input.signingSecret,
        env: input.env,
      });
      merged = true;
      break;
    }
    if (now() - started >= timeoutMs || attempt === steps) break;
    await sleep(intervalMs);
  }
  if (!merged) {
    const notice = { text: `recording PR #${recordingNumber} not merged: CI ${ciState}`, blocks: [] };
    notices.push(notice);
    return { status: "ci-blocked", notices, event: null, recordingPr: recordingNumber };
  }
  const source = await getPullRequestStatus(client, decision.pr);
  const event = {
    projectId: decision.projectId,
    completedStage: decision.stage,
    next: nextPhaseFor(decision.stage),
    baselineMergeCommit: source.mergeCommitSha,
    idempotencyKey: decision.idempotencyKey,
  };
  await commentOnPullRequest(client, decision.pr, renderTransition(event));
  const durable = (await listIssueComments(client, decision.pr))
    .map((comment) => commentRecord(comment.body, TRANSITION_KIND))
    .find((record) => record?.idempotencyKey === decision.idempotencyKey);
  const projectState = durable ? await projectStateForTransition(client, decision.projectId) : null;
  const handoff = durable && projectState ? startFromTransition(projectState, durable) : null;
  if (decision.stage === "srs") notices.push({ text: "iteration complete", blocks: [] });
  return { status: "transitioned", notices, event, recordingPr: recordingNumber, handoff };
}

async function projectStateForTransition(client, projectId) {
  try {
    const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
    const ref = repository?.default_branch;
    if (typeof ref !== "string" || !ref) return null;
    const yaml = await readRepoTextFile(client, `projects/${projectId}/project.yaml`, ref);
    if (!yaml) return null;
    return parseSimpleYaml(yaml);
  } catch {
    return null;
  }
}
