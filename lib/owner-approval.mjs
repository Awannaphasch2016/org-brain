import { createHash } from "node:crypto";

// A click writes one approval record. This module never merges or deploys.
// Filing also writes approvals/pending/<requestId>.json. A missing records
// branch is created from the default branch.
export const APPROVER_SLACK_ID = "U0CFRUV378D";
export const BOT_USER_ID = "U0CG2QNQRLM";
export const ISO_WORKFLOWS_BOT_ID = "B0CFSN7F5JT";
// Filled when #iso-approvals exists. Until then filing refuses to post.
export const APPROVAL_CHANNEL_ID = "<channelId>";
export const THREAD_SURFACE_CHANNELS = ["C0CG6SG8PNW"];
export const RECORDS_BRANCH = "iso-approval-records";
export const REQUESTS_BRANCH = "iso-approval-requests";
export const REPO = "Awannaphasch2016/org-brain";

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

export function authenticatedAppBotLogin(identity) {
  if (identity?.kind !== "github-app") return null;
  const login = identity.botLogin;
  if (typeof login !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]*\[bot\]$/.test(login)) return null;
  if (login === "cursor[bot]") return null;
  return login;
}

export function assertAppIdentity(identity) {
  if (authenticatedAppBotLogin(identity)) return { ok: true };
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
    if (!nonEmpty(target.vercelTeam) || !nonEmpty(target.vercelProject) || target.target !== "production") {
      throw new Error("merge-deploy target is invalid");
    }
    return;
  }
  if (kind === "deploy") {
    if (!exactKeys(target, ["vercelTeam", "vercelProject", "target"])) throw new Error("deploy target is invalid");
    if (!nonEmpty(target.vercelTeam) || !nonEmpty(target.vercelProject) || target.target !== "production") {
      throw new Error("deploy target is invalid");
    }
    return;
  }
  if (kind === "rollback") {
    if (!exactKeys(target, ["vercelTeam", "vercelProject", "target", "deploymentId"])) throw new Error("rollback target is invalid");
    if (!nonEmpty(target.vercelTeam) || !nonEmpty(target.vercelProject) || target.target !== "production" || !nonEmpty(target.deploymentId)) {
      throw new Error("rollback target is invalid");
    }
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
    if (!exactKeys(target, ["rowUrl", "contentSha256"])) throw new Error("experiment-run target is invalid");
    if (!/^https:\/\/\S+$/.test(target.rowUrl) || !sha256(target.contentSha256)) throw new Error("experiment-run target is invalid");
    return;
  }
  if (kind === "bootstrap-reconfirm") {
    if (key !== "bootstrap") throw new Error("bootstrap-reconfirm key must be bootstrap");
    if (!exactKeys(target, ["packetHash", "mergeSha40", "deploymentId"])) throw new Error("bootstrap-reconfirm target is invalid");
    if (!sha256(target.packetHash) || !sha40(target.mergeSha40) || !nonEmpty(target.deploymentId)) {
      throw new Error("bootstrap-reconfirm target is invalid");
    }
  }
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
    if (action.requestId !== undefined && action.requestId !== value.requestId) throw new Error("invalid request");
    if (seen.has(action.key)) throw new Error("invalid request");
    seen.add(action.key);
    assertTarget(action.kind, action.key, action.target);
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
  const text = `Approval request ${action.requestId} ${action.key}`;
  const blocks = [];
  if (action.title.length <= 150) {
    blocks.push({ type: "header", text: { type: "plain_text", text: action.title } });
  }
  blocks.push({
    type: "section",
    text: { type: "plain_text", text: action.statement },
  });
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

export function renderDecidedCard(record) {
  const line = renderDecisionLine(record);
  return {
    text: line,
    blocks: [{
      type: "section",
      block_id: decidedBlockId(record.actionHash),
      text: { type: "mrkdwn", text: line },
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

async function ensureBranch(client, branch) {
  const existing = await client.request("GET", repoPath(client, `/git/ref/heads/${encodeURIComponent(branch)}`), {
    allowNotFound: true,
  });
  if (existing?.object?.sha) return;
  const repository = await client.request("GET", repoPath(client, ""));
  const baseName = repository?.default_branch;
  if (!nonEmpty(baseName)) throw new Error("GitHub repository has no default branch");
  const base = await client.request("GET", repoPath(client, `/git/ref/heads/${encodeURIComponent(baseName)}`));
  const sha = base?.object?.sha;
  if (!sha40(sha)) throw new Error("GitHub default branch has no sha");
  try {
    await client.request("POST", repoPath(client, "/git/refs"), {
      body: { ref: `refs/heads/${branch}`, sha },
    });
  } catch (error) {
    if (!(error instanceof Error) || !/Reference already exists/i.test(error.message)) throw error;
  }
}

async function writeCreateOnly(client, { path, json, message, branch }) {
  const body = {
    message,
    content: Buffer.from(json, "utf8").toString("base64"),
    branch,
  };
  const put = () => client.request("PUT", repoPath(client, `/contents/${path}`), { body });
  try {
    return await put();
  } catch (error) {
    if (alreadyExists(error)) {
      const exists = new Error("already exists");
      exists.code = "ALREADY_EXISTS";
      throw exists;
    }
    if (!branchMissing(error)) throw error;
    await ensureBranch(client, branch);
    try {
      return await put();
    } catch (retry) {
      if (!alreadyExists(retry)) throw retry;
      const exists = new Error("already exists");
      exists.code = "ALREADY_EXISTS";
      throw exists;
    }
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
    cardRefs: record.cardRefs,
    clickedCardTs: record.clickedCardTs,
    decidedAt: record.decidedAt,
  }, null, 2)}\n`;
}

function parseRecord(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("record is invalid");
  if (!ID_TOKEN.test(value.requestId ?? "") || !ID_TOKEN.test(value.key ?? "")) throw new Error("record is invalid");
  if (!sha256(value.actionHash) || !nonEmpty(value.decision) || value.decidedBy !== APPROVER_SLACK_ID) throw new Error("record is invalid");
  if (!Array.isArray(value.cardRefs) || !nonEmpty(value.decidedAt) || typeof value.clickedCardTs !== "string") {
    throw new Error("record is invalid");
  }
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

async function messageUser(slack, ref) {
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
    const message = messages.find((item) => item?.ts === ref.ts);
    return authorFromSlackMessage(message);
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
  const identity = assertAppIdentity(input.client.identity);
  if (!identity.ok) return refused(PERSONAL_TOKEN);
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
  const pendingProof = await fileCommitProof(input.client, RECORDS_BRANCH, pendingPath(buttonValue.requestId));
  if (pendingProof === "foreign") {
    await ephemeral(input.slack, input, "Record mismatch: not shown, reported");
    return refused("RECORD_PROVENANCE_FAIL");
  }
  const pendingAction = pending.actions[buttonValue.key];
  const ref = cardRefFor(pendingAction, input.channelId, input.messageTs);
  if (!ref) return refused("wrong card");
  if (ref.surface !== "central" && ref.surface !== "thread") return refused("wrong card");
  if (ref.authorUserId !== BOT_USER_ID) return refused("card not by the bot");
  const author = await messageUser(input.slack, ref);
  if (author !== BOT_USER_ID) return refused("card not by the bot");

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

  const inspected = await inspectRecord(input.client, request.requestId, action.key);
  const trusted = inspected.state === "present" && recordMatchesAction(inspected.record, filedAction);
  if (refresh) {
    if (inspected.state === "missing") {
      await ephemeral(input.slack, input, "still pending");
      return { status: "pending", recorded: false };
    }
    if (!trusted) {
      await ephemeral(input.slack, input, "Record mismatch: not shown, reported");
      return refused("RECORD_MISMATCH");
    }
    await syncCards(input.slack, inspected.record, { postRecord: false, cardRefs: pendingAction.cardRefs });
    return { status: "refreshed", recorded: false, record: inspected.record };
  }

  if (!decisionMatches(input.actionId, action, buttonValue)) return refused("decision does not match the action");
  if (trusted) return alreadyDecided(input, inspected.record, pendingAction.cardRefs);

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
  const recordFile = recordPath(record.requestId, record.key);
  try {
    if (inspected.state === "missing") {
      await writeCreateOnly(input.client, {
        path: recordFile,
        json: stableRecord(record),
        message: `record approval ${record.requestId} ${record.key}`,
        branch: RECORDS_BRANCH,
      });
    } else {
      await writeReplacing(input.client, {
        path: recordFile,
        json: stableRecord(record),
        message: `replace untrusted approval ${record.requestId} ${record.key}`,
        branch: RECORDS_BRANCH,
        sha: inspected.sha,
      });
    }
  } catch (error) {
    if (error?.code === "ALREADY_EXISTS" && inspected.state === "missing") {
      const raced = await inspectRecord(input.client, record.requestId, record.key);
      if (raced.state === "present" && recordMatchesAction(raced.record, filedAction)) {
        return alreadyDecided(input, raced.record, pendingAction.cardRefs);
      }
    }
    if (inspected.state !== "missing") {
      await ephemeral(input.slack, input, "Record mismatch: not shown, reported");
      return refused("RECORD_PROVENANCE_FAIL");
    }
    if (conflicted(error)) {
      const winner = await inspectRecord(input.client, record.requestId, record.key);
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
          const again = await inspectRecord(input.client, record.requestId, record.key);
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

async function fileCommitProof(client, branch, path) {
  const login = authenticatedAppBotLogin(client?.identity);
  if (!login) return "foreign";
  let commits;
  try {
    const query = new URLSearchParams({ sha: branch, path, per_page: "1" });
    commits = await client.request("GET", repoPath(client, `/commits?${query}`));
  } catch {
    return "unread";
  }
  const commit = Array.isArray(commits) ? commits[0] : null;
  if (!commit) return "foreign";
  if (commit.author?.login === login && commit.committer?.login === login) return "app";
  return "foreign";
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

async function inspectRecord(client, requestId, key) {
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
  const proof = await fileCommitProof(client, RECORDS_BRANCH, path);
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
  await ephemeral(input.slack, input, `Already decided at ${record.decidedAt}`);
  await syncCards(input.slack, record, { postRecord: false, cardRefs });
  return { status: "already-decided", reason: "already decided", recorded: false, record };
}

export function authorFromSlackMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (message.user === BOT_USER_ID) return BOT_USER_ID;
  const userMissing = message.user === undefined || message.user === null || message.user === "";
  if (userMissing && message.bot_id === ISO_WORKFLOWS_BOT_ID) return BOT_USER_ID;
  return null;
}

function postedRef(surface, channel, threadTs, payload) {
  const ts = payload?.ts ?? payload?.message?.ts;
  const authorUserId = authorFromSlackMessage(payload?.message) ?? authorFromSlackMessage(payload);
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
  const identity = assertAppIdentity(input.client.identity);
  if (!identity.ok) return { status: "refused", reason: PERSONAL_TOKEN, posted: false, recorded: false };
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
  const existing = await readContents(input.client, pendingPath(request.requestId), RECORDS_BRANCH);
  if (existing) return { status: "already-filed", posted: false, recorded: false };
  if (request.actions.some((action) => action.kind === "experiment-run")) {
    return {
      status: "refused",
      reason: "experiment-run hash is not recomputed at card time",
      posted: false,
      recorded: false,
    };
  }

  const actions = {};
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
    actions[action.key] = {
      actionHash: action.actionHash,
      kind: action.kind,
      cardRefs: [
        postedRef("central", input.channelId, central?.ts ?? central?.message?.ts, central),
        postedRef("thread", input.threadChannel, input.threadTs, thread),
      ],
    };
  }
  const pending = {
    schema: PENDING_SCHEMA,
    requestId: request.requestId,
    blobSha: file.blobSha,
    actions,
  };
  try {
    await writeCreateOnly(input.client, {
      path: pendingPath(request.requestId),
      json: `${JSON.stringify(pending, null, 2)}\n`,
      message: `pin approval request ${request.requestId}`,
      branch: RECORDS_BRANCH,
    });
  } catch (error) {
    if (error?.code === "ALREADY_EXISTS") return { status: "already-filed", posted: true, recorded: false };
    throw error;
  }
  return { status: "filed", posted: true, recorded: false, pending };
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
  if (!input?.client?.request || !input.action || !input.card) {
    return { ok: false, reason: "record provenance was not checked" };
  }
  return verifyApprovalOnRepo(input);
}

async function verifyApprovalOnRepo({ client, action, card }) {
  let hash;
  try {
    hash = actionHash(action);
  } catch {
    return { ok: false, reason: "action is invalid" };
  }
  const pendingProof = await fileCommitProof(client, RECORDS_BRANCH, pendingPath(action.requestId));
  if (pendingProof !== "app") return { ok: false, reason: "RECORD_PROVENANCE_FAIL" };
  const inspected = await inspectRecord(client, action.requestId, action.key);
  const hashed = { ...action, actionHash: hash };
  if (inspected.state !== "present" || !recordMatchesAction(inspected.record, hashed)) {
    return { ok: false, reason: "RECORD_MISMATCH" };
  }
  if (inspected.record.decidedBy !== APPROVER_SLACK_ID) return { ok: false, reason: "clicker is not the approver" };
  if (action.kind === "decision") {
    if (!action.target?.options?.includes(inspected.record.decision)) return { ok: false, reason: "decision is not an option" };
  } else if (inspected.record.decision !== "approve") {
    return { ok: false, reason: "decision is not approve" };
  }
  const blocks = Array.isArray(card.blocks) ? card.blocks : [];
  if (blocks.some((block) => block?.type === "actions")) return { ok: false, reason: "card is not decided" };
  if (!blocks.some((block) => block?.block_id === decidedBlockId(hash))) return { ok: false, reason: "card is not decided" };
  return {
    ok: true,
    actionHash: hash,
    clickedCardTs: inspected.record.clickedCardTs ?? null,
    decidedAt: inspected.record.decidedAt ?? null,
  };
}

export async function claimExecution(client, input) {
  if (!sameRepo(client)) return { status: "refused", reason: "repository mismatch", recorded: false };
  const identity = assertAppIdentity(client.identity);
  if (!identity.ok) return { status: "refused", reason: PERSONAL_TOKEN, recorded: false };
  if (!ID_TOKEN.test(input?.requestId ?? "") || !ID_TOKEN.test(input?.key ?? "") || !nonEmpty(input?.executorId)) {
    return { status: "refused", reason: "invalid request", recorded: false };
  }
  const execution = {
    requestId: input.requestId,
    key: input.key,
    executorId: input.executorId,
    startedAt: formatIct(input.now ?? new Date()),
  };
  try {
    await writeCreateOnly(client, {
      path: `approvals/executions/${input.requestId}/${input.key}.json`,
      json: `${JSON.stringify(execution, null, 2)}\n`,
      message: `claim execution ${input.requestId} ${input.key}`,
      branch: RECORDS_BRANCH,
    });
  } catch (error) {
    if (error?.code === "ALREADY_EXISTS") return { status: "already-claimed", recorded: false };
    throw error;
  }
  return { status: "claimed", recorded: true, execution };
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
