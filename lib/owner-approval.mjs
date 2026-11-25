import { createHash } from "node:crypto";

// A click writes one approval record. This module never merges or deploys.
// It never creates a branch. A missing records, requests, or executions branch
// means the route is misconfigured.
import { branchRuleTypes, filledRulesetTemplates, rulesetHashesMatch } from "./ruleset-spec.mjs";

export const APPROVER_SLACK_ID = "U0CFRUV378D";
export const BOT_USER_ID = "U0CG2QNQRLM";
export const ISO_WORKFLOWS_BOT_ID = "B0CFSN7F5JT";
// Unconfirmed. A message that carries app_id is refused until this is filled.
export const SLACK_APP_ID = "<PH:slack-app-id>";
// Filled when #iso-approvals exists. Until then filing refuses to post.
export const APPROVAL_CHANNEL_ID = "<channelId>";
export const THREAD_SURFACE_CHANNELS = ["C0CG6SG8PNW"];
export const RECORDS_BRANCH = "iso-approval-records";
export const REQUESTS_BRANCH = "iso-approval-requests";
export const EXECUTIONS_BRANCH = "iso-approval-executions";
export const REPO = "Awannaphasch2016/org-brain";
export const VERCEL_TEAM = "team_HH56QrlGNZZs3DWHlokF5NlZ";
export const VERCEL_PROJECT = "prj_D4lCsHuXRH1ZLAXvliq5BkCDHwbm";
export const PRODUCTION_TARGET = "production";
// Unconfirmed read-only. These placeholders refuse an exact pin. cursor[bot] is never accepted.
export const APP_ID = "<PH:github-app-id>";
export const APP_BOT_LOGIN = "<PH:github-app-bot-login>";
export const APP_BOT_USER_ID = "<PH:github-app-bot-user-id>";
export const BOOTSTRAP_PACKET_ID = "isobp-20261125-01";
export const BOOTSTRAP_PACKET_EXPIRES_AT = "2026-12-09T23:59:59+07:00";
const FORBIDDEN_BOT_LOGINS = new Set(["cursor[bot]", "vercel[bot]", "github-actions[bot]"]);

export const RUN_DECLARATION_LABELS = [
  "run",
  "owner",
  "environment",
  "fixtures",
  "test channels",
  "allowed actions",
  "permissions",
  "supersedes",
];

const REQUEST_SCHEMA = "iso-approval-request/1";
const PENDING_SCHEMA = "iso-approval-pending/1";
const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SLACK_CHANNEL = /^C[A-Z0-9]+$/;
const APPROVAL_KINDS = new Set([
  "merge-deploy",
  "deploy",
  "rollback",
  "scope-page-edit",
  "decision",
  "experiment-run",
  "bootstrap-reconfirm",
]);

const MISCONFIGURED = "approval route misconfigured";
const PERSONAL_TOKEN = "personal-token identity";
const NOT_RECORDED = "approval was not recorded";

export function approvalChannelConfigured() {
  return SLACK_CHANNEL.test(APPROVAL_CHANNEL_ID);
}

export function sha256Hex(bytes) {
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  return createHash("sha256").update(data).digest("hex");
}

function compareUtf16(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = left.charCodeAt(index) - right.charCodeAt(index);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function assertWellFormed(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("jcs: lone surrogate");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("jcs: lone surrogate");
    }
  }
}

function serialize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("jcs: only finite integers are allowed");
    return String(value);
  }
  if (typeof value === "string") {
    assertWellFormed(value);
    return JSON.stringify(value);
  }
  if (typeof value === "undefined") throw new Error("jcs: undefined is not allowed");
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error("jcs: value cannot be serialized");
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error("jcs: undefined is not allowed");
      items.push(serialize(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("jcs: only plain objects are allowed");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("jcs: symbol keys are not allowed");
    const keys = Object.keys(value).sort(compareUtf16);
    const parts = [];
    for (const key of keys) {
      if (value[key] === undefined) throw new Error("jcs: undefined is not allowed");
      assertWellFormed(key);
      parts.push(`${JSON.stringify(key)}:${serialize(value[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error("jcs: value cannot be serialized");
}

export function jcs(value) {
  return serialize(value);
}

export function H(value) {
  return sha256Hex(jcs(value));
}

function walkStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walkStrings(value[key], visit);
  }
}

export function packetHash(packet) {
  walkStrings(packet, (text) => {
    if (text.startsWith("<PH:")) throw new Error("packet still contains a <PH: placeholder");
  });
  return H(packet);
}

function extractRunDeclaration(text) {
  const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s+Run declaration\s*$/.test(line));
  if (start === -1) throw new Error("run declaration has no Run declaration heading");
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line)) break;
    body.push(line);
  }
  return body;
}

export function canonicalRunDeclaration(text) {
  const found = new Map();
  for (const rawLine of extractRunDeclaration(text)) {
    if (rawLine.trim() === "") continue;
    const match = /^([^:]+): (.*)$/.exec(rawLine);
    if (!match) throw new Error("run declaration has an unlabeled line");
    const label = match[1];
    if (!RUN_DECLARATION_LABELS.includes(label)) throw new Error(`run declaration has an unknown label: ${label}`);
    if (found.has(label)) throw new Error(`run declaration repeats ${label}`);
    found.set(label, match[2].normalize("NFC").replace(/\s+/gu, " ").trim());
  }
  for (const label of RUN_DECLARATION_LABELS) {
    if (!found.has(label)) throw new Error(`run declaration is missing ${label}`);
  }
  const lines = ["iso-run-declaration/1", ...RUN_DECLARATION_LABELS.map((label) => `${label}: ${found.get(label)}`)];
  return `${lines.join("\n")}\n`;
}

export function runDeclarationSha256(text) {
  return sha256Hex(canonicalRunDeclaration(text));
}

export function formatIct(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error("invalid time");
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "+07:00");
}

export function approvalRouteMode(env = process.env) {
  const connector = env?.SLACK_CONNECTOR;
  const secret = env?.SLACK_SIGNING_SECRET;
  if (typeof connector === "string" && connector.trim() !== "") return { ok: false, reason: MISCONFIGURED };
  if (typeof secret !== "string" || secret.trim() === "") return { ok: false, reason: MISCONFIGURED };
  return { ok: true };
}

export function pinFilled(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("<PH:");
}

const SHIPPED_PINS = Object.freeze({
  appId: APP_ID,
  botLogin: APP_BOT_LOGIN,
  botUserId: APP_BOT_USER_ID,
  slackAppId: SLACK_APP_ID,
});

function appIdFilled(pins) {
  return Number.isInteger(Number(pins.appId)) && !String(pins.appId).startsWith("<PH:");
}

export function appPinsFilled(pins = SHIPPED_PINS) {
  return appIdFilled(pins)
    && pinFilled(pins.botLogin)
    && Number.isInteger(Number(pins.botUserId))
    && !String(pins.botUserId).startsWith("<PH:");
}

export function authenticatedAppBotLogin(identity, pins = SHIPPED_PINS) {
  if (!appPinsFilled(pins)) return null;
  const login = identity?.botLogin;
  if (typeof login !== "string" || login !== pins.botLogin || FORBIDDEN_BOT_LOGINS.has(login)) return null;
  if (identity?.kind !== "github-app" && identity?.kind !== "github-connector") return null;
  return login;
}

export function assertAppIdentity(identity, pins = SHIPPED_PINS) {
  if (authenticatedAppBotLogin(identity, pins)) return { ok: true };
  return { ok: false, reason: PERSONAL_TOKEN };
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sha40(value) {
  return typeof value === "string" && SHA40.test(value);
}

function sha256(value) {
  return typeof value === "string" && SHA256.test(value);
}

function assertTarget(kind, key, target) {
  if (kind === "merge-deploy") {
    if (!exactKeys(target, ["repo", "pr", "headSha40", "baseSha40", "method", "vercelTeam", "vercelProject", "target"])) {
      throw new Error("merge-deploy target is invalid");
    }
    if (target.repo !== REPO || !Number.isSafeInteger(target.pr) || target.pr < 1) throw new Error("merge-deploy target is invalid");
    if (!sha40(target.headSha40) || !sha40(target.baseSha40) || target.method !== "merge") throw new Error("merge-deploy target is invalid");
    if (target.vercelTeam !== VERCEL_TEAM || target.vercelProject !== VERCEL_PROJECT || target.target !== PRODUCTION_TARGET) {
      throw new Error("merge-deploy target is invalid");
    }
    return;
  }
  if (kind === "deploy") {
    if (!exactKeys(target, ["vercelTeam", "vercelProject", "target", "gitSha40"])) throw new Error("deploy target is invalid");
    if (target.vercelTeam !== VERCEL_TEAM || target.vercelProject !== VERCEL_PROJECT || target.target !== PRODUCTION_TARGET || !sha40(target.gitSha40)) {
      throw new Error("deploy target is invalid");
    }
    return;
  }
  if (kind === "rollback") {
    if (!exactKeys(target, ["vercelTeam", "vercelProject", "target", "deploymentId", "gitSha40"])) throw new Error("rollback target is invalid");
    if (target.vercelTeam !== VERCEL_TEAM || target.vercelProject !== VERCEL_PROJECT || target.target !== PRODUCTION_TARGET) {
      throw new Error("rollback target is invalid");
    }
    if (!/^dpl_[A-Za-z0-9]+$/.test(target.deploymentId ?? "") || !sha40(target.gitSha40)) throw new Error("rollback target is invalid");
    return;
  }
  if (kind === "scope-page-edit") {
    if (!exactKeys(target, ["page", "fromVersion", "toVersion", "textPath", "textSha256", "headSha40"])) {
      throw new Error("scope-page-edit target is invalid");
    }
    if (![target.page, target.fromVersion, target.toVersion, target.textPath].every(nonEmpty)) {
      throw new Error("scope-page-edit target is invalid");
    }
    if (!sha256(target.textSha256) || !sha40(target.headSha40)) throw new Error("scope-page-edit target is invalid");
    return;
  }
  if (kind === "decision") {
    if (!exactKeys(target, ["options"]) || !Array.isArray(target.options) || target.options.length < 2) {
      throw new Error("decision target is invalid");
    }
    const seen = new Set();
    for (const option of target.options) {
      const normalized = option.trim().toLowerCase();
      if (!nonEmpty(option) || normalized === "approve all" || normalized === "approve" || normalized === "reject" || seen.has(option)) {
        throw new Error("decision target is invalid");
      }
      seen.add(option);
    }
    return;
  }
  if (kind === "experiment-run") {
    if (!exactKeys(target, ["rowUrl", "contentSha256", "verifierNoteUrl"])) throw new Error("experiment-run target is invalid");
    if (!/^https:\/\/\S+$/.test(target.rowUrl) || !/^https:\/\/\S+$/.test(target.verifierNoteUrl) || !sha256(target.contentSha256)) {
      throw new Error("experiment-run target is invalid");
    }
    return;
  }
  if (kind === "bootstrap-reconfirm") {
    if (key !== "bootstrap") throw new Error("bootstrap-reconfirm key must be bootstrap");
    if (!exactKeys(target, ["packetId", "packetHash", "mergeSha40", "deploymentId", "packetExpiresAt", "cardExpiresAt"])) {
      throw new Error("bootstrap-reconfirm target is invalid");
    }
    if (target.packetId !== BOOTSTRAP_PACKET_ID || target.packetExpiresAt !== BOOTSTRAP_PACKET_EXPIRES_AT) {
      throw new Error("bootstrap-reconfirm target is invalid");
    }
    if (!sha256(target.packetHash) || !sha40(target.mergeSha40) || !/^dpl_[A-Za-z0-9]+$/.test(target.deploymentId ?? "")) {
      throw new Error("bootstrap-reconfirm target is invalid");
    }
    const cardExpires = Date.parse(target.cardExpiresAt ?? "");
    const packetExpires = Date.parse(BOOTSTRAP_PACKET_EXPIRES_AT);
    if (Number.isNaN(cardExpires) || cardExpires > packetExpires) throw new Error("bootstrap-reconfirm target is invalid");
  }
}

function filingTextAllowed(value) {
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  if (value.includes("<!") || value.includes("<@")) return false;
  return true;
}

export function bootstrapTitle(packetId = BOOTSTRAP_PACKET_ID) {
  return `Re-confirm Bootstrap Packet ${packetId}`;
}

export function bootstrapStatement(target) {
  return `I re-confirm Bootstrap Packet ${target.packetId} with packetHash ${target.packetHash}, merged as ${target.mergeSha40} and deployed to production as ${target.deploymentId}. Approving marks the ISO approval route live.`;
}

export function bootstrapCardExpiresAt(filedAt) {
  const filed = filedAt instanceof Date ? filedAt : new Date(filedAt);
  const cap = new Date(BOOTSTRAP_PACKET_EXPIRES_AT);
  const until = new Date(filed.getTime() + 72 * 60 * 60 * 1000);
  if (until.getTime() >= cap.getTime()) return BOOTSTRAP_PACKET_EXPIRES_AT;
  return formatIct(until);
}

export function bootstrapCardExpiryAllowed(filedAt, cardExpiresAt) {
  const filed = filedAt instanceof Date ? filedAt.getTime() : Date.parse(filedAt);
  const expires = Date.parse(cardExpiresAt ?? "");
  const packet = Date.parse(BOOTSTRAP_PACKET_EXPIRES_AT);
  if (Number.isNaN(filed) || Number.isNaN(expires) || Number.isNaN(packet)) return false;
  const cap = Math.min(filed + 72 * 60 * 60 * 1000, packet);
  return expires > filed && expires <= cap;
}

export function actionHash(action) {
  return H({
    requestId: action.requestId,
    key: action.key,
    kind: action.kind,
    title: action.title,
    statement: action.statement,
    target: action.target,
  });
}

export function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid request");
  if (Object.keys(value).some((key) => !["schema", "requestId", "actions"].includes(key))) throw new Error("invalid request");
  if (value.schema !== REQUEST_SCHEMA || !ID_TOKEN.test(value.requestId ?? "")) throw new Error("invalid request");
  if (!Array.isArray(value.actions) || value.actions.length === 0) throw new Error("invalid request");
  const seen = new Set();
  const actions = [];
  for (const action of value.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("invalid request");
    const allowed = ["key", "kind", "title", "statement", "target", "actionHash", "requestId"];
    if (Object.keys(action).some((key) => !allowed.includes(key))) throw new Error("invalid request");
    if (!ID_TOKEN.test(action.key ?? "") || !APPROVAL_KINDS.has(action.kind)) throw new Error("invalid request");
    if (!nonEmpty(action.title) || !nonEmpty(action.statement)) throw new Error("invalid request");
    if (!filingTextAllowed(action.title) || !filingTextAllowed(action.statement)) throw new Error("invalid request");
    if (action.requestId !== undefined && action.requestId !== value.requestId) throw new Error("invalid request");
    if (seen.has(action.key)) throw new Error("invalid request");
    seen.add(action.key);
    assertTarget(action.kind, action.key, action.target);
    if (action.kind === "bootstrap-reconfirm") {
      if (action.title !== bootstrapTitle(action.target.packetId) || action.statement !== bootstrapStatement(action.target)) {
        throw new Error("invalid request");
      }
    }
    const hash = actionHash({
      requestId: value.requestId,
      key: action.key,
      kind: action.kind,
      title: action.title,
      statement: action.statement,
      target: action.target,
    });
    if (action.actionHash !== undefined && action.actionHash !== hash) throw new Error("invalid request");
    actions.push({
      key: action.key,
      kind: action.kind,
      title: action.title,
      statement: action.statement,
      target: action.target,
      actionHash: hash,
    });
  }
  return { schema: REQUEST_SCHEMA, requestId: value.requestId, actions };
}

function decisionWord(decision) {
  if (decision === "approve") return "APPROVED";
  if (decision === "reject") return "REJECTED";
  return `DECIDED ${decision}`;
}

export function renderDecisionLine(record) {
  return `${decisionWord(record.decision)} by <@${APPROVER_SLACK_ID}> at ${record.decidedAt} · ${record.requestId} · ${record.key} · ${record.actionHash}`;
}

function button({ actionId, label, value, style }) {
  const encoded = JSON.stringify(value);
  if (encoded.length > 1900) throw new Error("approval button value is too long");
  const element = {
    type: "button",
    action_id: actionId,
    text: { type: "plain_text", text: label },
    value: encoded,
  };
  if (style) element.style = style;
  return element;
}

export function renderApprovalCard(action) {
  const hash = action.actionHash;
  const elements = [];
  if (action.kind === "decision") {
    for (const option of action.target.options) {
      elements.push(button({
        actionId: "iso-approval:option",
        label: option,
        value: { requestId: action.requestId, key: action.key, decision: option, option, actionHash: hash },
      }));
    }
  } else {
    elements.push(
      button({
        actionId: "iso-approval:approve",
        label: "Approve",
        style: "primary",
        value: { requestId: action.requestId, key: action.key, decision: "approve", actionHash: hash },
      }),
      button({
        actionId: "iso-approval:reject",
        label: "Reject",
        style: "danger",
        value: { requestId: action.requestId, key: action.key, decision: "reject", actionHash: hash },
      }),
    );
  }
  elements.push(button({
    actionId: "iso-approval:refresh",
    label: "Refresh",
    value: { requestId: action.requestId, key: action.key, decision: "refresh", actionHash: hash },
  }));
  const text = escapeSlackText(`Approval request ${action.requestId} ${action.key} ${action.title}`);
  const blocks = [];
  if (action.title.length <= 150) {
    blocks.push({ type: "header", text: { type: "plain_text", text: action.title } });
  }
  blocks.push({
    type: "section",
    text: { type: "plain_text", text: action.statement },
  });
  if (action.kind === "experiment-run") {
    blocks.push({
      type: "section",
      text: {
        type: "plain_text",
        text: `${action.target.rowUrl}\n${action.target.contentSha256}\n${action.target.verifierNoteUrl}`,
      },
    });
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`${hash}\`\nrequest \`${action.requestId}\` · ${action.kind} · \`${action.key}\``,
    },
  });
  blocks.push({ type: "actions", elements });
  return { text, blocks };
}

export function decidedBlockId(hash) {
  return `iso-approval-decided:${hash}`;
}

function escapeSlackText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderDecidedCard(record) {
  const line = renderDecisionLine(record);
  return {
    text: escapeSlackText(line),
    blocks: [{
      type: "section",
      block_id: decidedBlockId(record.actionHash),
      text: { type: "plain_text", text: line },
    }],
  };
}

export function parseApprovalRequestMention(text) {
  if (typeof text !== "string" || text.length > 4000) return null;
  const patterns = [
    /<@U0CG2QNQRLM(?:\|[^>]+)?>\s+approval-request\s+([A-Za-z0-9][A-Za-z0-9._-]{0,80})(?=$|\s)/,
    /(?:^|\s)@ISO Workflows\s+approval-request\s+([A-Za-z0-9][A-Za-z0-9._-]{0,80})(?=$|\s)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

function repoPath(client, suffix) {
  return `/repos/${client.owner}/${client.repo}${suffix}`;
}

function sameRepo(client) {
  return `${client?.owner}/${client?.repo}` === REPO;
}

function decodeGithubContent(payload) {
  if (!payload || typeof payload.content !== "string") throw new Error("GitHub content payload is missing");
  if (payload.encoding === "base64" || payload.encoding === undefined) {
    return Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  }
  return payload.content;
}

function alreadyExists(error) {
  return error instanceof Error && /failed \(422\)/.test(error.message) && /wasn't supplied|already exists/i.test(error.message) && !/branch not found/i.test(error.message);
}

function branchMissing(error) {
  if (!(error instanceof Error)) return false;
  if (/failed \(404\)/.test(error.message)) return true;
  return /failed \(422\)/.test(error.message) && /branch not found/i.test(error.message);
}

function conflicted(error) {
  return error instanceof Error && /failed \(409\)/.test(error.message);
}

async function writeCreateOnly(client, { path, json, message, branch }) {
  const body = {
    message,
    content: Buffer.from(json, "utf8").toString("base64"),
    branch,
  };
  try {
    return await client.request("PUT", repoPath(client, `/contents/${path}`), { body });
  } catch (error) {
    if (alreadyExists(error)) {
      const exists = new Error("already exists");
      exists.code = "ALREADY_EXISTS";
      throw exists;
    }
    if (branchMissing(error)) {
      const missing = new Error("route misconfigured");
      missing.code = "ROUTE_MISCONFIGURED";
      throw missing;
    }
    throw error;
  }
}

async function readContents(client, path, ref) {
  const payload = await client.request(
    "GET",
    repoPath(client, `/contents/${path}?ref=${encodeURIComponent(ref)}`),
    { allowNotFound: true },
  );
  if (payload === null) return null;
  if (!sha40(payload.sha ?? "")) throw new Error("GitHub content sha is invalid");
  return { text: decodeGithubContent(payload), blobSha: payload.sha };
}

async function readBlob(client, blobSha) {
  if (!sha40(blobSha)) throw new Error("pinned blob sha is invalid");
  const payload = await client.request("GET", repoPath(client, `/git/blobs/${blobSha}`));
  return decodeGithubContent(payload);
}

function recordPath(requestId, key) {
  return `approvals/records/${requestId}/${key}.json`;
}

function pendingPath(requestId) {
  return `approvals/pending/${requestId}.json`;
}

function requestPath(requestId) {
  return `approvals/requests/${requestId}.json`;
}

function stableRecord(record) {
  return `${JSON.stringify({
    requestId: record.requestId,
    key: record.key,
    actionHash: record.actionHash,
    decision: record.decision,
    decidedBy: record.decidedBy,
    clickedCardTs: record.clickedCardTs,
    decidedAt: record.decidedAt,
    cardAttestation: record.cardAttestation,
  }, null, 2)}\n`;
}

function parseRecord(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("record is invalid");
  if (!ID_TOKEN.test(value.requestId ?? "") || !ID_TOKEN.test(value.key ?? "")) throw new Error("record is invalid");
  if (!sha256(value.actionHash) || !nonEmpty(value.decision) || value.decidedBy !== APPROVER_SLACK_ID) throw new Error("record is invalid");
  if (!nonEmpty(value.decidedAt) || typeof value.clickedCardTs !== "string") throw new Error("record is invalid");
  return value;
}

function parsePending(text) {
  const value = JSON.parse(text);
  if (!value || value.schema !== PENDING_SCHEMA || !ID_TOKEN.test(value.requestId ?? "") || !sha40(value.blobSha ?? "")) {
    throw new Error("pending file is invalid");
  }
  if (!value.actions || typeof value.actions !== "object" || Array.isArray(value.actions)) throw new Error("pending file is invalid");
  return value;
}

async function slackCall(slack, method, body) {
  if (!slack) return null;
  return slack.request(method, body);
}

async function ephemeral(slack, input, text) {
  if (!slack || !input.channelId || !input.userId) return;
  try {
    await slack.request("chat.postEphemeral", {
      channel: input.channelId,
      user: input.userId,
      text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
  } catch {
    // The record decision does not depend on the notice reaching Slack.
  }
}

function refused(reason, extra = {}) {
  return { status: "refused", reason, recorded: false, ...extra };
}

async function resolveClicker(input) {
  if (input.isBot === true) return { ok: true, isBot: true, userId: input.userId };
  if (input.isBot === false && typeof input.userId === "string") return { ok: true, isBot: false, userId: input.userId };
  if (!input.slack || typeof input.userId !== "string") return { ok: false, reason: "slack user was not confirmed" };
  let info;
  try {
    info = await input.slack.request("users.info", { user: input.userId });
  } catch {
    return { ok: false, reason: "slack user was not confirmed" };
  }
  if (!info || info.ok !== true || !info.user) return { ok: false, reason: "slack user was not confirmed" };
  const isBot = info.user.is_bot === true || info.user.is_app_user === true || Boolean(info.user.bot_id);
  return { ok: true, isBot, userId: input.userId };
}

function parseButton(value) {
  let parsed;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const allowed = new Set(["requestId", "key", "decision", "actionHash", "option"]);
  if (Object.keys(parsed).some((key) => !allowed.has(key))) return null;
  return parsed;
}

async function cardMessage(slack, ref) {
  if (!slack) return null;
  try {
    const payload = await slack.request("conversations.replies", {
      channel: ref.channel,
      ts: ref.threadTs || ref.ts,
      latest: ref.ts,
      oldest: ref.ts,
      inclusive: true,
      limit: 2,
    });
    if (payload?.ok === false) return null;
    const messages = payload?.messages ?? [];
    return messages.find((item) => item?.ts === ref.ts) ?? null;
  } catch {
    return null;
  }
}

async function syncCards(slack, record, { postRecord, cardRefs }) {
  if (!slack) return [];
  const card = renderDecidedCard(record);
  const errors = [];
  for (const ref of cardRefs ?? record.cardRefs ?? []) {
    try {
      await slack.request("chat.update", { channel: ref.channel, ts: ref.ts, text: card.text, blocks: card.blocks });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "chat.update failed");
    }
    if (!postRecord) continue;
    try {
      await slack.request("chat.postMessage", {
        channel: ref.channel,
        thread_ts: ref.ts,
        text: `approval record\n${JSON.stringify(record)}`,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "chat.postMessage failed");
    }
  }
  return errors;
}

function cardRefFor(pendingAction, channelId, messageTs) {
  return (pendingAction?.cardRefs ?? []).find((ref) => ref.channel === channelId && ref.ts === messageTs) ?? null;
}

export async function handleApprovalClick(input) {
  const type = input.type ?? "block_actions";
  if (type !== "block_actions" || !String(input.actionId ?? "").startsWith("iso-approval:")) {
    return { status: "ignored", reason: "not a click", recorded: false };
  }
  const mode = approvalRouteMode(input.env ?? process.env);
  if (!mode.ok) {
    await ephemeral(input.slack, input, MISCONFIGURED);
    return refused(MISCONFIGURED);
  }
  if (!sameRepo(input.client) || !input.client?.request) return refused("repository mismatch");
  const pins = input.pins ?? SHIPPED_PINS;
  const proveApp = (client, branch, path) => fileCommitProof(client, branch, path, 1, pins);
  const identity = assertAppIdentity(input.client.identity, pins);
  if (!identity.ok) return refused(identity.reason);
  if (!(await rulesetsMatchLive(input.client, pins))) return refused("RULESET_MISMATCH");
  const clicker = await resolveClicker(input);
  if (!clicker.ok) {
    await ephemeral(input.slack, input, NOT_RECORDED);
    return refused(clicker.reason);
  }
  if (clicker.isBot) return refused("bot click");
  if (clicker.userId !== APPROVER_SLACK_ID) return refused("clicker is not the approver");

  const refresh = input.actionId === "iso-approval:refresh";
  const buttonValue = refresh ? parseButton(input.value) : parseButton(input.value);
  if (!buttonValue || !ID_TOKEN.test(buttonValue.requestId ?? "") || !ID_TOKEN.test(buttonValue.key ?? "")) {
    return refused("button value is invalid");
  }
  if (!refresh && (!sha256(buttonValue.actionHash ?? "") || !nonEmpty(buttonValue.decision))) {
    return refused("button value is invalid");
  }

  let pendingFile;
  try {
    pendingFile = await readContents(input.client, pendingPath(buttonValue.requestId), RECORDS_BRANCH);
  } catch {
    return refused("pending file is invalid");
  }
  if (!pendingFile) return refused("unknown request");
  let pending;
  try {
    pending = parsePending(pendingFile.text);
  } catch {
    return refused("pending file is invalid");
  }
  if (pending.requestId !== buttonValue.requestId) return refused("unknown request");
  const pendingProof = await fileCommitProof(input.client, RECORDS_BRANCH, pendingPath(buttonValue.requestId), 1, pins);
  if (pendingProof !== "app") return refused("RECORD_PROVENANCE_FAIL");
  const pendingAction = pending.actions[buttonValue.key];
  const ref = cardRefFor(pendingAction, input.channelId, input.messageTs);
  if (!ref) return refused("wrong card");
  if (ref.surface !== "central" && ref.surface !== "thread") return refused("wrong card");
  if (ref.authorUserId !== BOT_USER_ID) return refused("card not by the bot");
  const posted = await cardMessage(input.slack, ref);
  if (authorFromSlackMessage(posted, pins) !== BOT_USER_ID) return refused("card not by the bot");

  let request;
  try {
    const raw = await readBlob(input.client, pending.blobSha);
    request = validateRequest(JSON.parse(raw));
  } catch {
    return refused("hash mismatch");
  }
  if (request.requestId !== buttonValue.requestId) return refused("hash mismatch");
  const action = request.actions.find((item) => item.key === buttonValue.key);
  if (!action || action.actionHash !== pendingAction.actionHash) return refused("hash mismatch");
  if (!refresh && buttonValue.actionHash !== action.actionHash) return refused("hash mismatch");
  const filedAction = { ...action, requestId: request.requestId };

  const inspected = await inspectRecord(input.client, request.requestId, action.key, proveApp);
  const trusted = inspected.state === "present" && recordMatchesAction(inspected.record, filedAction);
  if (refresh) {
    if (inspected.state === "missing") {
      await ephemeral(input.slack, input, "still pending");
      return { status: "pending", recorded: false };
    }
    if (!trusted) {
      return holdMismatch(input, pendingAction.cardRefs, recordPath(request.requestId, action.key), {
        requestId: request.requestId,
        key: action.key,
        recordHash: inspected.record?.actionHash ?? null,
        actionHash: action.actionHash,
      });
    }
    await syncCards(input.slack, inspected.record, { postRecord: false, cardRefs: pendingAction.cardRefs });
    return { status: "refreshed", recorded: false, record: inspected.record };
  }

  if (!decisionMatches(input.actionId, action, buttonValue)) return refused("decision does not match the action");
  if (action.kind === "bootstrap-reconfirm") {
    const expired = await bootstrapClickGate(input, filedAction, pendingAction);
    if (expired) return expired;
  }
  if (trusted && inspected.record.decision === buttonValue.decision) {
    return alreadyDecided(input, inspected.record, pendingAction.cardRefs);
  }
  if (trusted) return differentDecision(input, inspected.record, pendingAction.cardRefs, buttonValue.decision);
  if (inspected.state !== "missing") {
    return holdMismatch(input, pendingAction.cardRefs, recordPath(request.requestId, action.key), {
      requestId: request.requestId,
      key: action.key,
      recordHash: inspected.record?.actionHash ?? null,
      actionHash: action.actionHash,
    });
  }

  const now = input.now ?? new Date();
  const record = {
    requestId: request.requestId,
    key: action.key,
    actionHash: action.actionHash,
    decision: buttonValue.decision,
    decidedBy: APPROVER_SLACK_ID,
    cardRefs: pendingAction.cardRefs,
    clickedCardTs: typeof input.messageTs === "string" ? input.messageTs : "",
    decidedAt: formatIct(now),
  };
  // blocksSha256 is the SHA-256 of the decided blocks as this App recorded them at the signed click.
  // It binds the create-only record. verifyApproval recomputes it from the record and does not read Slack.
  record.cardAttestation = {
    channel: input.channelId,
    ts: input.messageTs,
    user: posted.user,
    bot_id: posted.bot_id,
    app_id: typeof posted.app_id === "string" && posted.app_id !== "" ? posted.app_id : null,
    blocksSha256: sha256Hex(jcs(renderDecidedCard(record).blocks)),
  };
  const recordFile = recordPath(record.requestId, record.key);
  try {
    await writeCreateOnly(input.client, {
      path: recordFile,
      json: stableRecord(record),
      message: `record approval ${record.requestId} ${record.key}`,
      branch: RECORDS_BRANCH,
    });
  } catch (error) {
    if (error?.code === "ROUTE_MISCONFIGURED") return refused("route misconfigured");
    if (error?.code === "ALREADY_EXISTS") {
      const raced = await inspectRecord(input.client, record.requestId, record.key, proveApp);
      if (raced.state === "present" && recordMatchesAction(raced.record, filedAction)) {
        return alreadyDecided(input, raced.record, pendingAction.cardRefs);
      }
      return holdMismatch(input, pendingAction.cardRefs, recordFile, {
        requestId: record.requestId,
        key: record.key,
        recordHash: raced.record?.actionHash ?? null,
        actionHash: filedAction.actionHash,
      });
    }
    if (conflicted(error)) {
      const winner = await inspectRecord(input.client, record.requestId, record.key, proveApp);
      if (winner.state === "present" && recordMatchesAction(winner.record, filedAction)) {
        return alreadyDecided(input, winner.record, pendingAction.cardRefs);
      }
      try {
        await writeCreateOnly(input.client, {
          path: recordFile,
          json: stableRecord(record),
          message: `record approval ${record.requestId} ${record.key}`,
          branch: RECORDS_BRANCH,
        });
      } catch (retry) {
        if (retry?.code === "ALREADY_EXISTS") {
          const again = await inspectRecord(input.client, record.requestId, record.key, proveApp);
          if (again.state === "present" && recordMatchesAction(again.record, filedAction)) {
            return alreadyDecided(input, again.record, pendingAction.cardRefs);
          }
        }
        await ephemeral(input.slack, input, "not recorded, click again");
        return refused("not recorded, click again");
      }
    } else {
      return refused("record was not written");
    }
  }
  const syncErrors = await syncCards(input.slack, record, { postRecord: true, cardRefs: pendingAction.cardRefs });
  return { status: "recorded", recorded: true, record, syncErrors };
}

function decisionMatches(actionId, action, buttonValue) {
  if (action.kind === "decision") {
    if (actionId !== "iso-approval:option") return false;
    if (buttonValue.option !== buttonValue.decision) return false;
    return action.target.options.includes(buttonValue.decision);
  }
  if (buttonValue.option !== undefined) return false;
  if (buttonValue.decision === "approve") return actionId === "iso-approval:approve";
  if (buttonValue.decision === "reject") return actionId === "iso-approval:reject";
  return false;
}

function commitMatches(commit, login, userId) {
  if (commit?.author?.login !== login || commit?.committer?.login !== login) return false;
  if (commit?.commit?.verification?.verified !== true) return false;
  if (userId != null && (commit.author?.id !== userId || commit.committer?.id !== userId)) return false;
  return true;
}

function commitListWithin(commits, login, userId, maxCommits) {
  if (!Array.isArray(commits) || commits.length < 1 || commits.length > maxCommits) return false;
  return commits.every((commit) => commitMatches(commit, login, userId));
}

export function appCommitListOk(commits, login, userId = null) {
  return commitListWithin(commits, login, userId, 1);
}

async function readCommitList(client, branch, path, perPage) {
  const query = new URLSearchParams({ sha: branch, path, per_page: String(perPage) });
  return client.request("GET", repoPath(client, `/commits?${query}`));
}

async function fileCommitProof(client, branch, path, maxCommits = 1, pins = SHIPPED_PINS) {
  const login = authenticatedAppBotLogin(client?.identity, pins);
  if (!login) return "foreign";
  let commits;
  try {
    commits = await readCommitList(client, branch, path, maxCommits + 1);
  } catch {
    return "unread";
  }
  if (!commitListWithin(commits, login, Number(pins.botUserId), maxCommits)) return "foreign";
  return "app";
}

async function pinnedFileCommitProof(client, branch, path, maxCommits = 1, pins = SHIPPED_PINS) {
  if (!appPinsFilled(pins)) return "foreign";
  let commits;
  try {
    commits = await readCommitList(client, branch, path, maxCommits + 1);
  } catch {
    return "unread";
  }
  if (!commitListWithin(commits, pins.botLogin, Number(pins.botUserId), maxCommits)) return "foreign";
  return "app";
}

async function rulesetsMatchLive(client, pins = SHIPPED_PINS) {
  const expected = filledRulesetTemplates(Number(pins.appId));
  if (!expected) return false;
  let listed;
  try {
    listed = await client.request("GET", repoPath(client, "/rulesets"));
  } catch {
    return false;
  }
  if (!Array.isArray(listed) || listed.length === 0) return false;
  const full = [];
  for (const item of listed) {
    if (Array.isArray(item?.rules) && typeof item.name === "string") {
      full.push(item);
      continue;
    }
    if (!Number.isInteger(item?.id)) return false;
    try {
      full.push(await client.request("GET", repoPath(client, `/rulesets/${item.id}`)));
    } catch {
      return false;
    }
  }
  if (!rulesetHashesMatch(full, expected)) return false;
  for (const branch of [RECORDS_BRANCH, REQUESTS_BRANCH, EXECUTIONS_BRANCH]) {
    let rules;
    try {
      rules = await client.request("GET", repoPath(client, `/rules/branches/${encodeURIComponent(branch)}`));
    } catch {
      return false;
    }
    const types = new Set((Array.isArray(rules) ? rules : []).map((rule) => rule?.type));
    if (!branchRuleTypes(branch).every((type) => types.has(type))) return false;
  }
  return true;
}

async function holdMismatch(input, cardRefs, path, detail = {}) {
  let recordCommitSha = null;
  try {
    const query = new URLSearchParams({ sha: RECORDS_BRANCH, path, per_page: "2" });
    const commits = await input.client.request("GET", repoPath(input.client, `/commits?${query}`));
    recordCommitSha = Array.isArray(commits) ? commits[0]?.sha ?? null : null;
  } catch {
    recordCommitSha = null;
  }
  console.error(`RECORD_MISMATCH ${JSON.stringify({
    requestId: detail.requestId ?? null,
    key: detail.key ?? null,
    path,
    recordCommitSha,
    recordHash: detail.recordHash ?? null,
    actionHash: detail.actionHash ?? null,
  })}`);
  await ephemeral(input.slack, input, "Record mismatch: not shown, reported");
  await holdCards(input.slack, cardRefs, "HELD: record mismatch (see Scope Guard)");
  return refused("RECORD_MISMATCH");
}

async function writeReplacing(client, { path, json, message, branch, sha }) {
  if (typeof sha !== "string" || sha.length === 0) {
    throw new Error("a replacement needs the existing blob sha");
  }
  return client.request("PUT", repoPath(client, `/contents/${path}`), {
    body: {
      message,
      content: Buffer.from(json, "utf8").toString("base64"),
      branch,
      sha,
    },
  });
}

async function inspectRecord(client, requestId, key, prove = fileCommitProof) {
  const path = recordPath(requestId, key);
  let file;
  try {
    file = await readContents(client, path, RECORDS_BRANCH);
  } catch {
    return { state: "unreadable" };
  }
  if (!file) return { state: "missing" };
  let record = null;
  try {
    record = parseRecord(file.text);
  } catch {
    record = null;
  }
  const proof = await prove(client, RECORDS_BRANCH, path);
  if (proof !== "app" || !record) return { state: "untrusted", sha: file.blobSha, record };
  return { state: "present", sha: file.blobSha, record };
}

function recordMatchesAction(record, action) {
  if (!record) return false;
  if (record.requestId !== action.requestId || record.key !== action.key) return false;
  if (record.actionHash !== action.actionHash) return false;
  if (action.kind === "decision") return Array.isArray(action.target?.options) && action.target.options.includes(record.decision);
  return record.decision === "approve" || record.decision === "reject";
}

async function alreadyDecided(input, record, cardRefs) {
  const word = decisionWord(record.decision);
  await ephemeral(input.slack, input, `Already ${word} by <@${APPROVER_SLACK_ID}> at ${record.decidedAt}`);
  await syncCards(input.slack, record, { postRecord: false, cardRefs });
  return { status: "already-decided", reason: "already decided", recorded: false, record };
}

async function differentDecision(input, record, cardRefs, attempted) {
  const word = decisionWord(record.decision);
  await ephemeral(
    input.slack,
    input,
    `Already ${word} at ${record.decidedAt}. This ${attempted} was NOT recorded. To withdraw, ask the Lead to file a new request`,
  );
  await syncCards(input.slack, record, { postRecord: false, cardRefs });
  return { status: "already-decided", reason: "different decision was not recorded", recorded: false, record };
}

export function authorFromSlackMessage(message, pins = SHIPPED_PINS) {
  if (!message || typeof message !== "object") return null;
  if (message.user !== BOT_USER_ID || message.bot_id !== ISO_WORKFLOWS_BOT_ID) return null;
  if (message.app_id != null && message.app_id !== "") {
    if (!pinFilled(pins.slackAppId) || message.app_id !== pins.slackAppId) return null;
  }
  return BOT_USER_ID;
}

function postedRef(surface, channel, threadTs, payload, pins = SHIPPED_PINS) {
  const ts = payload?.ts ?? payload?.message?.ts;
  const authorUserId = authorFromSlackMessage(payload?.message, pins) ?? authorFromSlackMessage(payload, pins);
  if (typeof ts !== "string" || ts === "") throw new Error("Slack did not return a message ts");
  if (authorUserId !== BOT_USER_ID) throw new Error("Slack card was not authored by the bot");
  return { surface, channel, ts, threadTs: threadTs || ts, authorUserId };
}

export async function deliverApprovalRequest(input) {
  const mode = approvalRouteMode(input.env ?? process.env);
  if (!mode.ok) return { status: "refused", reason: MISCONFIGURED, posted: false, recorded: false };
  if (!SLACK_CHANNEL.test(input.channelId ?? "")) {
    return { status: "refused", reason: "approval channel is not configured", posted: false, recorded: false };
  }
  if (!THREAD_SURFACE_CHANNELS.includes(input.threadChannel)) {
    return { status: "ignored", reason: "channel is not a thread surface", posted: false, recorded: false };
  }
  if (!sameRepo(input.client)) return { status: "refused", reason: "repository mismatch", posted: false, recorded: false };
  const pins = input.pins ?? SHIPPED_PINS;
  const identity = assertAppIdentity(input.client.identity, pins);
  if (!identity.ok) return { status: "refused", reason: identity.reason, posted: false, recorded: false };
  if (!(await rulesetsMatchLive(input.client, pins))) {
    return { status: "refused", reason: "RULESET_MISMATCH", posted: false, recorded: false };
  }
  if (!ID_TOKEN.test(input.requestId ?? "") || !nonEmpty(input.threadTs)) {
    return { status: "refused", reason: "invalid request", posted: false, recorded: false };
  }
  const file = await readContents(input.client, requestPath(input.requestId), REQUESTS_BRANCH);
  if (!file) return { status: "refused", reason: "request not found", posted: false, recorded: false };
  let request;
  try {
    request = validateRequest(JSON.parse(file.text));
  } catch {
    return { status: "refused", reason: "invalid request", posted: false, recorded: false };
  }
  if (request.requestId !== input.requestId) return { status: "refused", reason: "invalid request", posted: false, recorded: false };
  // Before filing a rollback, the executor compares that deployment's meta.githubCommitSha
  // with gitSha40 and refuses to file on a mismatch. This app does not call Vercel.
  for (const action of request.actions) {
    if (action.kind !== "deploy" && action.kind !== "rollback") continue;
    if (!(await shaReachableFromMain(input.client, action.target.gitSha40))) {
      return { status: "refused", reason: "gitSha40 is not reachable from main", posted: false, recorded: false };
    }
  }
  const existing = await readContents(input.client, pendingPath(request.requestId), RECORDS_BRANCH);
  if (existing) return { status: "already-filed", posted: false, recorded: false };
  const filedAt = input.now ?? new Date();
  if (filedAt.getTime() > Date.parse(BOOTSTRAP_PACKET_EXPIRES_AT) && request.actions.some((action) => action.kind === "bootstrap-reconfirm")) {
    return { status: "refused", reason: "bootstrap packet has expired", posted: false, recorded: false };
  }
  for (const action of request.actions) {
    if (action.kind !== "bootstrap-reconfirm") continue;
    if (!bootstrapCardExpiryAllowed(filedAt, action.target.cardExpiresAt)) {
      return { status: "refused", reason: "bootstrap card expiry does not match", posted: false, recorded: false };
    }
    const lockRefusal = await bootstrapLockRefusal(input.client, action, request.requestId, filedAt, pins);
    if (lockRefusal) return { status: "refused", reason: lockRefusal, posted: false, recorded: false };
  }

  if (!pinFilled(pins.slackAppId)) {
    return { status: "refused", reason: "slack app pin is unfilled", posted: false, recorded: false };
  }
  const actions = {};
  const posted = [];
  try {
    for (const action of request.actions) {
      const cardAction = { ...action, requestId: request.requestId };
      const card = renderApprovalCard(cardAction);
      const central = await slackCall(input.slack, "chat.postMessage", {
        channel: input.channelId,
        text: card.text,
        blocks: card.blocks,
      });
      const thread = await slackCall(input.slack, "chat.postMessage", {
        channel: input.threadChannel,
        thread_ts: input.threadTs,
        text: card.text,
        blocks: card.blocks,
      });
      const cardRefs = [
        postedRef("central", input.channelId, central?.ts ?? central?.message?.ts, central, pins),
        postedRef("thread", input.threadChannel, input.threadTs, thread, pins),
      ];
      posted.push(...cardRefs);
      actions[action.key] = { actionHash: action.actionHash, kind: action.kind, cardRefs };
    }
  } catch (error) {
    await holdCards(input.slack, posted, "NOT FILED: retry");
    return { status: "refused", reason: error instanceof Error ? error.message : "card not by the bot", posted: posted.length > 0, recorded: false };
  }
  const pending = {
    schema: PENDING_SCHEMA,
    requestId: request.requestId,
    blobSha: file.blobSha,
    actions,
  };
  try {
    for (const action of request.actions) {
      if (action.kind !== "bootstrap-reconfirm") continue;
      await writeBootstrapLock(input.client, action, request.requestId, filedAt);
    }
    await writeCreateOnly(input.client, {
      path: pendingPath(request.requestId),
      json: `${JSON.stringify(pending, null, 2)}\n`,
      message: `pin approval request ${request.requestId}`,
      branch: RECORDS_BRANCH,
    });
  } catch (error) {
    await holdCards(input.slack, posted, "NOT FILED: retry");
    if (error?.code === "ALREADY_EXISTS") return { status: "already-filed", posted: true, recorded: false };
    if (error?.code === "ROUTE_MISCONFIGURED") return { status: "refused", reason: "route misconfigured", posted: true, recorded: false };
    return { status: "refused", reason: "NOT FILED: retry", posted: true, recorded: false };
  }
  return { status: "filed", posted: true, recorded: false, pending };
}

export async function shaReachableFromMain(client, sha) {
  try {
    const compare = await client.request("GET", repoPath(client, `/compare/main...${sha}`));
    return compare?.status === "behind" || compare?.status === "identical";
  } catch {
    return false;
  }
}

async function bootstrapLockRefusal(client, action, requestId, filedAt, pins = SHIPPED_PINS) {
  let locks;
  try {
    locks = await listBootstrapLocks(client);
  } catch {
    return "route misconfigured";
  }
  for (const path of locks) {
    const file = await readContents(client, path, RECORDS_BRANCH);
    if (!file) continue;
    let lock;
    try {
      lock = JSON.parse(file.text);
    } catch {
      return "bootstrap lock is invalid";
    }
    const record = await readContents(client, recordPath(lock.requestId, "bootstrap"), RECORDS_BRANCH);
    if (record) {
      try {
        if (parseRecord(record.text).decision === "approve") return "bootstrap route is already live";
        return "bootstrap packet already has a decision";
      } catch {
        return "bootstrap lock is invalid";
      }
    }
    const proof = await fileCommitProof(client, RECORDS_BRANCH, path, 2, pins);
    if (proof !== "app") return "RECORD_PROVENANCE_FAIL";
    const supersede = await lockSupersedeFailure(client, path, lock);
    if (supersede) return supersede;
    if (path === lockPath(action.target.packetHash)) {
      if (lock.requestId === requestId && lock.actionHash === action.actionHash) {
        const pending = await readContents(client, pendingPath(requestId), RECORDS_BRANCH);
        if (!pending) return null;
        return "bootstrap card is already filed";
      }
      if (lock.supersedes) return "bootstrap card cannot be filed again";
      const expired = Date.parse(lock.cardExpiresAt) < filedAt.getTime();
      if (!expired) return "bootstrap card is already filed";
    }
  }
  return null;
}

async function listBootstrapLocks(client) {
  let payload;
  try {
    payload = await client.request(
      "GET",
      repoPath(client, `/contents/approvals/bootstrap?ref=${encodeURIComponent(RECORDS_BRANCH)}`),
      { allowNotFound: true },
    );
  } catch (error) {
    throw error;
  }
  if (payload === null) return [];
  if (Array.isArray(payload)) return payload.filter((item) => item?.type === "file" && typeof item.path === "string").map((item) => item.path);
  if (payload.type === "file" && typeof payload.path === "string") return [payload.path];
  return [];
}

async function writeBootstrapLock(client, action, requestId, filedAt) {
  const path = lockPath(action.target.packetHash);
  const existing = await readContents(client, path, RECORDS_BRANCH);
  const lock = {
    packetHash: action.target.packetHash,
    requestId,
    actionHash: action.actionHash,
    filedAt: formatIct(filedAt),
    cardExpiresAt: action.target.cardExpiresAt,
    ...(existing ? { supersedes: JSON.parse(existing.text).requestId } : {}),
  };
  const json = `${JSON.stringify(lock, null, 2)}\n`;
  if (existing) {
    const previous = JSON.parse(existing.text);
    const decided = await readContents(client, recordPath(previous.requestId, "bootstrap"), RECORDS_BRANCH);
    if (decided) {
      const error = new Error("bootstrap lock is decided");
      error.code = "LOCK_FINAL";
      throw error;
    }
    if (previous.requestId === requestId) return;
    if (previous.supersedes) {
      const error = new Error("bootstrap card cannot be filed again");
      error.code = "LOCK_FINAL";
      throw error;
    }
  }
  if (!existing) {
    await writeCreateOnly(client, {
      path,
      json,
      message: `lock bootstrap ${action.target.packetHash}`,
      branch: RECORDS_BRANCH,
    });
    return;
  }
  await writeReplacing(client, {
    path,
    json,
    message: `supersede bootstrap ${action.target.packetHash}`,
    branch: RECORDS_BRANCH,
    sha: existing.blobSha,
  });
}

export async function fileApprovalRequest(input) {
  const mode = approvalRouteMode(input.env ?? process.env);
  if (!mode.ok) return { status: "refused", reason: MISCONFIGURED, posted: false, recorded: false };
  if (!approvalChannelConfigured()) {
    return { status: "refused", reason: "approval channel is not configured", posted: false, recorded: false };
  }
  return deliverApprovalRequest({ ...input, channelId: APPROVAL_CHANNEL_ID });
}

export function verifyApproval(input) {
  if (!input?.client?.request || !input.action) {
    return { ok: false, reason: "record provenance was not checked" };
  }
  return verifyApprovalOnRepo(input);
}

function attestationFailure(attestation, record, pins = SHIPPED_PINS) {
  if (!attestation || attestation.user !== BOT_USER_ID || attestation.bot_id !== ISO_WORKFLOWS_BOT_ID) {
    return "card not by the bot";
  }
  if (pinFilled(pins.slackAppId)) {
    if (attestation.app_id !== pins.slackAppId) return "card not by the bot";
  } else if (attestation.app_id != null && attestation.app_id !== "") {
    return "card not by the bot";
  }
  if (attestation.blocksSha256 !== sha256Hex(jcs(renderDecidedCard(record).blocks))) return "card is not decided";
  return null;
}

async function verifyApprovalOnRepo({ client, action, pins: suppliedPins }) {
  const pins = suppliedPins ?? SHIPPED_PINS;
  let hash;
  try {
    hash = actionHash(action);
  } catch {
    return { ok: false, reason: "action is invalid" };
  }
  const pendingProof = await pinnedFileCommitProof(client, RECORDS_BRANCH, pendingPath(action.requestId), 1, pins);
  if (pendingProof !== "app") return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
  let pendingFile;
  try {
    pendingFile = await readContents(client, pendingPath(action.requestId), RECORDS_BRANCH);
  } catch {
    return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
  }
  if (!pendingFile) return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
  let pending;
  try {
    pending = parsePending(pendingFile.text);
  } catch {
    return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
  }
  if (pending.actions?.[action.key]?.actionHash !== hash) return { ok: false, reason: "RECORD_MISMATCH" };
  const inspected = await inspectRecord(client, action.requestId, action.key, (github, branch, path) => pinnedFileCommitProof(github, branch, path, 1, pins));
  const hashed = { ...action, actionHash: hash };
  if (inspected.state === "present" && recordMatchesAction(inspected.record, hashed)) {
    const attestation = inspected.record.cardAttestation;
    const cardReason = attestationFailure(attestation, inspected.record, pins);
    if (cardReason) return { ok: false, reason: cardReason };
    const refs = pending.actions?.[action.key]?.cardRefs ?? [];
    if (!refs.some((ref) => ref.channel === attestation.channel && ref.ts === attestation.ts)) {
      return { ok: false, reason: "card is not on file" };
    }
  }
  if (!(await rulesetsMatchLive(client, pins))) return { ok: false, reason: "RULESET_MISMATCH" };
  if (inspected.state !== "present" || !recordMatchesAction(inspected.record, hashed)) {
    return { ok: false, reason: "RECORD_MISMATCH" };
  }
  if (inspected.record.decidedBy !== APPROVER_SLACK_ID) return { ok: false, reason: "clicker is not the approver" };
  if (action.kind === "decision") {
    if (!action.target?.options?.includes(inspected.record.decision)) return { ok: false, reason: "decision is not an option" };
  } else if (inspected.record.decision !== "approve") {
    return { ok: false, reason: "decision is not approve" };
  }
  if (action.kind === "bootstrap-reconfirm" && Date.parse(inspected.record.decidedAt) > Date.parse(action.target?.cardExpiresAt)) {
    return { ok: false, reason: "bootstrap decision is expired" };
  }
  const markerPath = `approvals/executions/${action.requestId}/${action.key}.json`;
  let marker;
  try {
    marker = await readContents(client, markerPath, EXECUTIONS_BRANCH);
  } catch {
    return { ok: false, reason: "execution marker was not readable" };
  }
  if (marker) return { ok: false, reason: "execution marker already exists" };
  let rawRequest;
  try {
    rawRequest = validateRequest(JSON.parse(await readBlob(client, pending.blobSha)));
  } catch {
    return { ok: false, reason: "RECORD_MISMATCH" };
  }
  const fromBlob = rawRequest.actions.find((item) => item.key === action.key);
  if (!fromBlob || fromBlob.actionHash !== hash || rawRequest.requestId !== action.requestId) {
    return { ok: false, reason: "RECORD_MISMATCH" };
  }
  if (action.kind === "bootstrap-reconfirm") {
    const lockProof = await pinnedFileCommitProof(client, RECORDS_BRANCH, lockPath(action.target.packetHash), 2, pins);
    if (lockProof !== "app") return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
    let lockFile;
    try {
      lockFile = await readContents(client, lockPath(action.target.packetHash), RECORDS_BRANCH);
    } catch {
      return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
    }
    if (!lockFile) return { ok: false, reason: "RECORD_MISMATCH" };
    const lock = JSON.parse(lockFile.text);
    if (lock.requestId !== action.requestId || lock.actionHash !== hash) return { ok: false, reason: "RECORD_MISMATCH" };
    const supersede = await lockSupersedeFailure(client, lockPath(action.target.packetHash), lock);
    if (supersede) return { ok: false, reason: supersede };
    if (Date.parse(inspected.record.decidedAt) > Date.parse(lock.cardExpiresAt)) {
      return { ok: false, reason: "bootstrap decision is expired" };
    }
  }
  let recordCommitSha = null;
  try {
    const query = new URLSearchParams({
      sha: RECORDS_BRANCH,
      path: recordPath(action.requestId, action.key),
      per_page: "1",
    });
    const commits = await client.request("GET", repoPath(client, `/commits?${query}`));
    recordCommitSha = Array.isArray(commits) ? commits[0]?.sha ?? null : null;
  } catch {
    recordCommitSha = null;
  }
  return {
    ok: true,
    actionHash: hash,
    recordCommitSha,
    pendingBlobSha: pending.blobSha ?? null,
    cardTs: (pending.actions?.[action.key]?.cardRefs ?? []).map((ref) => ref.ts),
    clickedCardTs: inspected.record.clickedCardTs ?? null,
    decidedAt: inspected.record.decidedAt ?? null,
  };
}

export async function claimExecution(client, input) {
  if (!sameRepo(client)) return { status: "refused", reason: "repository mismatch", recorded: false };
  const executor = input?.executorId ?? input?.executor;
  if (!ID_TOKEN.test(input?.requestId ?? "") || !ID_TOKEN.test(input?.key ?? "") || !nonEmpty(executor)) {
    return { status: "refused", reason: "invalid request", recorded: false };
  }
  const execution = {
    requestId: input.requestId,
    key: input.key,
    executor,
    startedAt: formatIct(input.now ?? new Date()),
    recordCommitSha: sha40(input.recordCommitSha) ? input.recordCommitSha : null,
    committerLogin: typeof client.identity?.botLogin === "string" ? client.identity.botLogin : null,
  };
  try {
    await writeCreateOnly(client, {
      path: `approvals/executions/${input.requestId}/${input.key}.json`,
      json: `${JSON.stringify(execution, null, 2)}\n`,
      message: `claim execution ${input.requestId} ${input.key}`,
      branch: EXECUTIONS_BRANCH,
    });
  } catch (error) {
    if (error?.code === "ALREADY_EXISTS") return { status: "already-claimed", recorded: false };
    if (error?.code === "ROUTE_MISCONFIGURED") return { status: "refused", reason: "route misconfigured", recorded: false };
    throw error;
  }
  return { status: "claimed", recorded: true, execution };
}

async function holdCards(slack, cardRefs, text) {
  if (!slack) return;
  for (const ref of cardRefs ?? []) {
    try {
      await slack.request("chat.update", {
        channel: ref.channel,
        ts: ref.ts,
        text,
        blocks: [{ type: "section", text: { type: "plain_text", text } }],
      });
    } catch {
      // The refusal does not depend on the card update.
    }
  }
}

function lockPath(packetHash) {
  return `approvals/bootstrap/${packetHash}.json`;
}

async function lockSupersedeFailure(client, path, lock) {
  let commits;
  try {
    commits = await readCommitList(client, RECORDS_BRANCH, path, 3);
  } catch {
    return "RECORD_PROVENANCE_FAIL";
  }
  if (!Array.isArray(commits) || commits.length < 1 || commits.length > 2) return "RECORD_PROVENANCE_FAIL";
  if (commits.length === 1) return null;
  const olderSha = commits[commits.length - 1]?.sha;
  if (!sha40(olderSha)) return "RECORD_PROVENANCE_FAIL";
  let previousFile;
  try {
    previousFile = await readContents(client, path, olderSha);
  } catch {
    return "RECORD_PROVENANCE_FAIL";
  }
  if (!previousFile) return "RECORD_PROVENANCE_FAIL";
  let previous;
  try {
    previous = JSON.parse(previousFile.text);
  } catch {
    return "RECORD_PROVENANCE_FAIL";
  }
  if (typeof lock?.supersedes !== "string" || lock.supersedes !== previous.requestId) return "RECORD_PROVENANCE_FAIL";
  const expiredAt = Date.parse(previous.cardExpiresAt ?? "");
  const filedAt = Date.parse(lock.filedAt ?? "");
  if (Number.isNaN(expiredAt) || Number.isNaN(filedAt) || expiredAt >= filedAt) return "RECORD_PROVENANCE_FAIL";
  let record;
  try {
    record = await readContents(client, recordPath(previous.requestId, "bootstrap"), RECORDS_BRANCH);
  } catch {
    return "RECORD_PROVENANCE_FAIL";
  }
  if (record) return "RECORD_PROVENANCE_FAIL";
  return null;
}

async function bootstrapClickGate(input, action, pendingAction) {
  let lockFile;
  try {
    lockFile = await readContents(input.client, lockPath(action.target.packetHash), RECORDS_BRANCH);
  } catch {
    return refused("route misconfigured");
  }
  if (!lockFile) return refused("bootstrap lock is missing");
  const lockProof = await fileCommitProof(input.client, RECORDS_BRANCH, lockPath(action.target.packetHash), 2, input.pins ?? SHIPPED_PINS);
  if (lockProof !== "app") return refused("RECORD_PROVENANCE_FAIL");
  let lock;
  try {
    lock = JSON.parse(lockFile.text);
  } catch {
    return refused("RECORD_MISMATCH");
  }
  if (lock.requestId !== action.requestId || lock.actionHash !== action.actionHash) {
    return refused("bootstrap card is not the lock");
  }
  const supersede = await lockSupersedeFailure(input.client, lockPath(action.target.packetHash), lock);
  if (supersede) return refused(supersede);
  const now = input.now ?? new Date();
  const deadline = Math.min(Date.parse(action.target.cardExpiresAt), Date.parse(BOOTSTRAP_PACKET_EXPIRES_AT));
  if (Number.isNaN(deadline) || now.getTime() > deadline) {
    await holdCards(input.slack, pendingAction.cardRefs, "EXPIRED: no decision recorded");
    return refused("EXPIRED");
  }
  return null;
}

function scrub(error) {
  const message = error instanceof Error ? error.message : "approval failed";
  return message.replace(/ghs_[A-Za-z0-9_]+/g, "[redacted]").replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]").slice(0, 300);
}

export function createApprovalHandlers({ createClient, env = () => process.env, now = () => new Date() } = {}) {
  return {
    async onInteraction(action, ctx) {
      try {
        const client = await createClient();
        await handleApprovalClick({
          type: "block_actions",
          actionId: action.actionId,
          value: action.value,
          userId: action.user?.id,
          channelId: ctx.slack.channelId,
          messageTs: action.messageTs,
          threadTs: ctx.slack.threadTs,
          env: env(),
          now: now(),
          client,
          slack: ctx.slack,
        });
      } catch (error) {
        console.error(`[iso-approval] ${scrub(error)}`);
      }
    },
    async onMessage(message, ctx) {
      const requestId = parseApprovalRequestMention(message?.text);
      if (!requestId) return false;
      if (!THREAD_SURFACE_CHANNELS.includes(message.channelId)) return false;
      if (ctx?.edit) return true;
      try {
        const client = await createClient();
        await fileApprovalRequest({
          requestId,
          threadChannel: message.channelId,
          threadTs: message.threadTs ?? message.ts,
          client,
          slack: ctx.slack,
          env: env(),
        });
      } catch (error) {
        console.error(`[iso-approval] ${scrub(error)}`);
      }
      return true;
    },
  };
}
