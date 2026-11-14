import { createHash } from "node:crypto";
import { authorizeSlackActor } from "./authz.mjs";
import { markProjectRejected } from "./baseline.mjs";
import { verifyGateDecision } from "./gate-decision.mjs";
import {
  closePullRequest,
  getPullRequestStatus,
  listIssueComments,
  openProjectYamlPullRequest,
  openSetupPullRequest,
  readRepoTextFile,
} from "./github.mjs";
import { parseSimpleYaml, setYamlPath } from "./project-yaml.mjs";
import { renderGateCard } from "./slack-gate.mjs";

export const PROJECT_ID_MAX = 48;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;
const UPLOADER = /^slack:[^:\s]+:([UW][A-Z0-9]+)$/;
const STAMP = /^[0-9]{8}T[0-9]{6}Z$/;

export const STARTER_SCALAR_PATHS = [
  "status",
  "intake.source.path",
  "intake.source.sha256",
  "intake.source.mediaType",
  "intake.source.uploadedBy",
  "intake.source.uploadedAt",
  "intake.source.slackFileId",
  "intake.setupPullRequest",
  "tor.path",
  "tor.status",
  "tor.pullRequest",
  "tor.branch",
  "tor.baseline.mergeCommit",
  "tor.baseline.approvedAt",
  "tor.baseline.approvedBy",
  "tor.baseline.sha256",
  "srs.path",
  "srs.status",
  "srs.pullRequest",
  "srs.branch",
  "srs.baseline.mergeCommit",
  "srs.baseline.approvedAt",
  "srs.baseline.approvedBy",
  "srs.baseline.sha256",
  "srs.baseline.sourceTorCommit",
  "architecture.path",
  "architecture.status",
  "architecture.pullRequest",
  "architecture.branch",
  "architecture.baseline.mergeCommit",
  "architecture.baseline.approvedAt",
  "architecture.baseline.approvedBy",
  "architecture.baseline.sha256",
  "architecture.baseline.sourceSrsCommit",
];

function quote(value) {
  return JSON.stringify(String(value));
}

export function assessProjectId(projectId) {
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId) || projectId.length > PROJECT_ID_MAX) {
    return { ok: false, reason: "invalid project id" };
  }
  return { ok: true };
}

export function assessTorUpload({ filename, mediaType, bytes }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.byteLength === 0) return { ok: false, reason: "empty file" };
  if (buffer.byteLength > 1_000_000) return { ok: false, reason: "file is larger than 1 MB" };
  const name = String(filename ?? "").toLowerCase();
  const markdown = name.endsWith(".md");
  const plain = name.endsWith(".txt");
  if (!markdown && !plain) return { ok: false, reason: "wrong file type" };
  if (markdown && mediaType !== "text/markdown") return { ok: false, reason: "wrong file type" };
  if (plain && mediaType !== "text/plain") return { ok: false, reason: "wrong file type" };
  if (buffer.includes(0)) return { ok: false, reason: "binary file" };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, reason: "binary file" };
  }
  return { ok: true, text: buffer.toString("utf8"), sha256: createHash("sha256").update(buffer).digest("hex") };
}

const ATTACHMENT_ROOT = "/workspace/.eve/attachments/";

export function resolveSlackAttachmentPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    return { ok: false, reason: "attachment path is missing" };
  }
  const raw = inputPath.trim().replace(/\\/g, "/");
  if (raw.includes("\0")) return { ok: false, reason: "attachment path is outside the Slack upload store" };
  const absolute = raw.startsWith("/workspace/")
    ? raw
    : raw.startsWith("/")
      ? `/workspace${raw}`
      : `/workspace/${raw.replace(/^\.\//, "")}`;
  const parts = [];
  for (const part of absolute.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return { ok: false, reason: "attachment path is outside the Slack upload store" };
    parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (!normalized.startsWith(ATTACHMENT_ROOT)) {
    return { ok: false, reason: "attachment path is outside the Slack upload store" };
  }
  const rest = normalized.slice(ATTACHMENT_ROOT.length);
  const segments = rest.split("/");
  if (segments.length !== 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return { ok: false, reason: "attachment path is outside the Slack upload store" };
  }
  return {
    ok: true,
    path: normalized,
    filename: segments[1],
    attachmentId: segments[0],
  };
}

export function mediaTypeForTorFilename(filename) {
  const name = String(filename ?? "").toLowerCase();
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  return null;
}

export function loadSlackUpload({ attachmentPath, bytes }) {
  const located = resolveSlackAttachmentPath(attachmentPath);
  if (!located.ok) return located;
  const mediaType = mediaTypeForTorFilename(located.filename);
  if (!mediaType) return { ok: false, reason: "wrong file type" };
  const upload = assessTorUpload({ filename: located.filename, mediaType, bytes });
  if (!upload.ok) return upload;
  return {
    ok: true,
    ...upload,
    path: located.path,
    filename: located.filename,
    mediaType,
    slackFileId: `attachment:${located.attachmentId}`,
  };
}

export function slackUserFromUploader(uploadedBy) {
  const match = UPLOADER.exec(String(uploadedBy ?? ""));
  return match?.[1] ?? null;
}

export function renderStarterProjectYaml({
  id,
  title,
  uploader,
  uploadedAt,
  slackFileId,
  sourceSha256,
  mediaType,
}) {
  const userId = slackUserFromUploader(uploader);
  return `id: ${id}
title: ${quote(title)}
status: active
intake:
  source:
    path: intake/tor-source.md
    sha256: ${sourceSha256}
    mediaType: ${mediaType}
    uploadedBy: ${quote(uploader)}
    uploadedAt: ${quote(uploadedAt)}
    slackFileId: ${slackFileId}
  setupPullRequest: null
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
    - ${userId}
`;
}

async function defaultBranch(client) {
  const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
  if (typeof repository?.default_branch !== "string" || !repository.default_branch) {
    throw new Error("repository has no default branch");
  }
  return repository.default_branch;
}

export async function projectIdAvailable(client, projectId) {
  const base = await defaultBranch(client);
  const existing = await client.request(
    "GET",
    `/repos/${client.owner}/${client.repo}/contents/projects/${projectId}?ref=${encodeURIComponent(base)}`,
    { allowNotFound: true },
  );
  if (existing) return { ok: false, reason: "project id already exists on the default branch" };
  for (const prefix of [`setup/${projectId}/`, `tor/${projectId}/`]) {
    const refs = await client.request(
      "GET",
      `/repos/${client.owner}/${client.repo}/git/matching-refs/heads/${prefix}`,
      { allowNotFound: true },
    );
    if (Array.isArray(refs) && refs.length > 0) {
      return { ok: false, reason: "project id already has an open branch" };
    }
  }
  return { ok: true, base };
}

export async function createProjectSetup(client, input) {
  const id = assessProjectId(input.projectId);
  if (!id.ok) throw new Error(id.reason);
  const actor = authorizeSlackActor({ userId: input.userId, allowedUserIds: input.allowedUserIds });
  if (!actor.allowed) throw new Error(actor.reason);
  const uploaderId = slackUserFromUploader(input.uploadedBy);
  if (!uploaderId || uploaderId !== input.userId) {
    throw new Error("uploader is not the signed-in Slack user");
  }
  const upload = assessTorUpload({ filename: input.filename, mediaType: input.mediaType, bytes: input.bytes });
  if (!upload.ok) throw new Error(upload.reason);
  const available = await projectIdAvailable(client, input.projectId);
  if (!available.ok) throw new Error(available.reason);
  const stamp = input.stamp;
  if (!STAMP.test(stamp)) throw new Error(`invalid setup stamp: ${stamp}`);
  const projectYaml = renderStarterProjectYaml({
    id: input.projectId,
    title: input.title,
    uploader: input.uploadedBy,
    uploadedAt: input.uploadedAt,
    slackFileId: input.slackFileId,
    sourceSha256: upload.sha256,
    mediaType: input.mediaType,
  });
  const prefix = `projects/${input.projectId}/`;
  const opened = await openSetupPullRequest(client, {
    projectId: input.projectId,
    baseBranch: available.base,
    stamp,
    title: `Set up ${input.projectId}`,
    body: [
      `Project setup for \`${input.projectId}\`.`,
      "",
      "This pull request contains only `project.yaml` and `intake/tor-source.md`.",
      "Reject closes it. Nothing is merged by the agent.",
    ].join("\n"),
    files: [
      { path: `${prefix}project.yaml`, content: projectYaml },
      { path: `${prefix}intake/tor-source.md`, content: upload.text },
    ],
  });
  const card = renderGateCard({
    projectId: input.projectId,
    stage: "setup",
    repo: `${client.owner}/${client.repo}`,
    pr: opened.number,
    headSha: opened.headSha,
  });
  return { ...opened, projectYaml, card, merged: false };
}

export async function closeSetupProject(client, { projectId, pullNumber }) {
  const status = await getPullRequestStatus(client, pullNumber);
  if (!String(status.headRef ?? "").startsWith(`setup/${projectId}/`)) {
    throw new Error("refusing to close a pull request that is not this project's setup");
  }
  if (status.merged) throw new Error("refusing to close a merged setup pull request");
  await closePullRequest(client, pullNumber);
  return { closed: true, merged: false, pullNumber };
}

async function verifiedDecision(client, { pullNumber, projectId, expectedAction, allowedUserIds, signingSecret, liveHeadSha }) {
  if (!client.identity?.botLogin) throw new Error("refusing to read a gate decision without a GitHub identity");
  const comments = await listIssueComments(client, pullNumber);
  let found = null;
  for (const comment of comments) {
    const result = verifyGateDecision({
      comment,
      expectedAuthorLogin: client.identity.botLogin,
      repo: `${client.owner}/${client.repo}`,
      pullNumber,
      liveHeadSha,
      allowedUserIds,
      projectId,
      signingSecret,
      requireMac: client.identity.kind === "personal-token",
      requireCi: false,
      ciGreen: true,
      expectedAction,
    });
    if (result.ok) found = result.decision;
  }
  return found;
}

export async function openRejectedStatusPullRequest(client, input) {
  const id = assessProjectId(input.projectId);
  if (!id.ok) throw new Error(id.reason);
  if (!STAMP.test(input.stamp)) throw new Error(`invalid setup stamp: ${input.stamp}`);
  const status = await getPullRequestStatus(client, input.pullNumber);
  if (!status.headSha) throw new Error("the pull request has no head commit");
  const decision = await verifiedDecision(client, {
    pullNumber: input.pullNumber,
    projectId: input.projectId,
    expectedAction: "reject",
    allowedUserIds: input.allowedUserIds,
    signingSecret: input.signingSecret,
    liveHeadSha: status.headSha,
  });
  if (!decision || decision.action !== "reject") {
    throw new Error("refusing to mark a project rejected without a gate reject decision");
  }
  const base = await defaultBranch(client);
  const path = `projects/${input.projectId}/project.yaml`;
  const current = await readRepoTextFile(client, path, base);
  if (current == null) throw new Error("project.yaml was not found on the default branch");
  const projectYaml = markProjectRejected(current);
  const before = parseSimpleYaml(current);
  const after = parseSimpleYaml(projectYaml);
  if (after.status !== "rejected" || before.status === "rejected") {
    throw new Error("rejected status was not recorded");
  }
  const opened = await openProjectYamlPullRequest(client, {
    projectId: input.projectId,
    baseBranch: base,
    branch: `setup/${input.projectId}/reject/${input.stamp}`,
    title: `Reject ${input.projectId}`,
    message: `Mark ${input.projectId} rejected`,
    projectYamlPath: path,
    projectYaml,
    body: `Records status: rejected for \`${input.projectId}\` from gate decision on pull request #${input.pullNumber}. This pull request does not merge itself.`,
  });
  return { ...opened, merged: false, status: "rejected" };
}

export function starterYamlAcceptsWrites(yaml) {
  let next = yaml;
  for (const path of STARTER_SCALAR_PATHS) {
    const sample = path.endsWith("pullRequest") || path === "intake.setupPullRequest" ? 1 : "value";
    next = setYamlPath(next, path, sample);
  }
  return parseSimpleYaml(next);
}
