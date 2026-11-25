import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gateApproverIds } from "../lib/gate-actions.mjs";
import { GithubClient } from "../lib/github.mjs";
import {
  APPROVAL_CHANNEL_ID,
  APPROVER_SLACK_ID,
  BOT_USER_ID,
  RECORDS_BRANCH,
  REQUESTS_BRANCH,
  THREAD_SURFACE_CHANNELS,
  actionHash,
  approvalChannelConfigured,
  approvalRouteMode,
  canonicalRunDeclaration,
  createApprovalHandlers,
  deliverApprovalRequest,
  fileApprovalRequest,
  formatIct,
  handleApprovalClick,
  jcs,
  packetHash,
  parseApprovalRequestMention,
  renderApprovalCard,
  runDeclarationSha256,
  sha256Hex,
  validateRequest,
} from "../lib/owner-approval.mjs";

const root = new URL("..", import.meta.url);
const APPROVER = APPROVER_SLACK_ID;
const BOT = BOT_USER_ID;
const SECRET = "test-signing-secret";
const ENV = { SLACK_SIGNING_SECRET: SECRET };
const NOW = new Date("2026-11-25T07:00:00.000Z");
const ICT = "2026-11-25T14:00:00.000+07:00";
const CENTRAL = "C0ISOAPPROV";
const THREAD = THREAD_SURFACE_CHANNELS[0];
const CENTRAL_TS = "1700000000.000100";
const THREAD_CARD_TS = "1700000000.000200";
const THREAD_PARENT = "1700000000.000050";
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const ACTION_JCS = `{"key":"merge","kind":"merge-deploy","requestId":"iso-req-1","statement":"Merge PR 70 at the recorded head.","target":{"baseSha40":"${BASE}","headSha40":"${HEAD}","method":"merge","pr":70,"repo":"Awannaphasch2016/org-brain","target":"production","vercelProject":"prj_D4lCsHuXRH1ZLAXvliq5BkCDHwbm","vercelTeam":"team_HH56QrlGNZZs3DWHlokF5NlZ"},"title":"Merge the route PR"}`;
const ACTION_HASH = "f7d0eaed6c011a77d4ba0ce7bb93c85ffb423075b3ab2f9ff3c6c077bc5a4acf";
const PACKET_JCS = '{"approver":{"slackUserId":"U0CFRUV378D","venue":"ISO Workflow Lead 1:1 chat"},"decisions":["Q5=merge-deploy","Q6=A"],"n":1,"packetId":"isobp-20261125-01","schema":"iso-bootstrap-packet/1"}';
const PACKET_HASH = "cc4248a8a176788dd0fe7e6fce0ecc9f864cb0cac50725eac840cada46b0a209";
const RUN_CANONICAL = [
  "iso-run-declaration/1",
  "run: ISO-RUN-1",
  "owner: ISO Workflow Lead",
  "environment: staging",
  "fixtures: none",
  "test channels: C0TEST",
  "allowed actions: read",
  "permissions: none",
  "supersedes: none",
].join("\n") + "\n";
const RUN_HASH = "ec9b0e4d4a17ad15833184db456965dd400b84f7ff246b8aa7aa5ecea6a43ba1";

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

function sha1(text) {
  return createHash("sha1").update(text).digest("hex");
}

function approvalGithub(identity) {
  const state = { files: new Map(), blobs: new Map() };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT" && pathname.includes("/contents/")) {
      if (body?.sha !== undefined) return http({ message: "sha was supplied" }, 422);
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const key = `${body.branch}:${filePath}`;
      if (state.files.has(key)) return http({ message: '"sha" wasn\'t supplied.' }, 422);
      const text = Buffer.from(body.content, "base64").toString("utf8");
      state.files.set(key, text);
      return http({ content: { sha: "d".repeat(40) } }, 201);
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const text = state.files.get(`${parsed.searchParams.get("ref")}:${filePath}`);
      if (text == null) return http({ message: "Not Found" }, 404);
      const blob = sha1(text);
      state.blobs.set(blob, text);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), sha: blob, type: "file" });
    }
    if (method === "GET" && /\/git\/blobs\/[0-9a-f]+$/.test(pathname)) {
      const blob = pathname.split("/").pop();
      const text = state.blobs.get(blob);
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), sha: blob });
    }
    if (method === "GET" && pathname === "/repos/Awannaphasch2016/org-brain") return http({ default_branch: "main" });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref }, 201);
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({
    fetchImpl,
    token: "test-token",
    owner: "Awannaphasch2016",
    repo: "org-brain",
    identity: identity ?? { kind: "github-app", botLogin: "iso-workflows[bot]", label: "github-app (iso-workflows[bot])" },
  });
  return { client, state };
}

function slackDouble({ users } = {}) {
  const messages = [];
  const calls = [];
  return {
    messages,
    calls,
    async request(method, body) {
      calls.push({ method, body });
      if (method === "users.info") {
        const user = users?.[body.user] ?? { id: body.user, is_bot: false };
        return { ok: true, user };
      }
      if (method === "chat.postMessage") {
        const ts = body.ts ?? `${1700000000 + messages.length}.000100`;
        messages.push({ channel: body.channel, ts, threadTs: body.thread_ts ?? ts, user: BOT });
        return { ok: true, ts, channel: body.channel, message: { user: BOT, ts, bot_id: "B0ISO" } };
      }
      if (method === "chat.update") return { ok: true, ts: body.ts };
      if (method === "chat.postEphemeral") return { ok: true };
      if (method === "conversations.replies") {
        const found = messages.filter((item) => item.channel === body.channel && (item.ts === body.ts || item.threadTs === body.ts));
        return { ok: true, messages: found.map((item) => ({ ts: item.ts, user: item.user, bot_id: item.user === BOT ? "B0ISO" : undefined })) };
      }
      throw new Error(`unexpected slack ${method}`);
    },
  };
}

function mergeAction() {
  return {
    key: "merge",
    kind: "merge-deploy",
    title: "Merge the route PR",
    statement: "Merge PR 70 at the recorded head.",
    target: {
      repo: "Awannaphasch2016/org-brain",
      pr: 70,
      headSha40: HEAD,
      baseSha40: BASE,
      method: "merge",
      vercelTeam: "team_HH56QrlGNZZs3DWHlokF5NlZ",
      vercelProject: "prj_D4lCsHuXRH1ZLAXvliq5BkCDHwbm",
      target: "production",
    },
  };
}

function requestDocument(action = mergeAction(), requestId = "iso-req-1") {
  return { schema: "iso-approval-request/1", requestId, actions: [action] };
}

function storeText(github, branch, path, text) {
  github.state.files.set(`${branch}:${path}`, text);
  const blob = sha1(text);
  github.state.blobs.set(blob, text);
  return blob;
}

function cardRefs(author = BOT) {
  return [
    { surface: "central", channel: CENTRAL, ts: CENTRAL_TS, threadTs: CENTRAL_TS, authorUserId: author },
    { surface: "thread", channel: THREAD, ts: THREAD_CARD_TS, threadTs: THREAD_PARENT, authorUserId: author },
  ];
}

function seedSlack(slack, refs, user = BOT) {
  for (const ref of refs) slack.messages.push({ channel: ref.channel, ts: ref.ts, threadTs: ref.threadTs, user });
}

function seedReady(action = mergeAction(), requestId = "iso-req-1") {
  const github = approvalGithub();
  const request = validateRequest(requestDocument(action, requestId));
  const blobSha = storeText(github, REQUESTS_BRANCH, `approvals/requests/${requestId}.json`, `${JSON.stringify(request)}\n`);
  const refs = cardRefs();
  const pending = {
    schema: "iso-approval-pending/1",
    requestId,
    blobSha,
    actions: Object.fromEntries(request.actions.map((item) => [item.key, { actionHash: item.actionHash, kind: item.kind, cardRefs: refs }])),
  };
  storeText(github, RECORDS_BRANCH, `approvals/pending/${requestId}.json`, `${JSON.stringify(pending)}\n`);
  const slack = slackDouble();
  seedSlack(slack, refs);
  return { github, slack, request, refs };
}

function click(setup, button, overrides = {}) {
  return {
    type: overrides.type ?? "block_actions",
    actionId: overrides.actionId ?? button?.action_id,
    value: overrides.value ?? button?.value,
    userId: overrides.userId ?? APPROVER,
    isBot: overrides.isBot,
    channelId: overrides.channelId ?? CENTRAL,
    messageTs: overrides.messageTs ?? CENTRAL_TS,
    threadTs: overrides.threadTs ?? CENTRAL_TS,
    env: overrides.env ?? ENV,
    now: overrides.now ?? NOW,
    client: setup.github.client,
    slack: setup.slack,
  };
}

function approveButton(request) {
  const action = { ...request.actions[0], requestId: request.requestId };
  const rendered = renderApprovalCard(action);
  return rendered.blocks.find((block) => block.type === "actions").elements[0];
}

function recordPuts(client) {
  return client.calls.filter((call) => call.method === "PUT" && call.path.includes("/approvals/records/"));
}

function assertNoMergeOrDeploy(client) {
  for (const call of client.calls) {
    const path = call.path.split("?")[0];
    assert.equal(/\/pulls\/[^/]+\/merge$/.test(path), false, path);
    assert.equal(/vercel|\/deployments/i.test(path), false, path);
    assert.notEqual(call.method, "MERGE");
  }
}

test("golden packet and run declaration hashes stay fixed", async () => {
  const packet = JSON.parse(await readFile(new URL("tests/fixtures/owner-approval/packet.json", root), "utf8"));
  const expectedJcs = await readFile(new URL("tests/fixtures/owner-approval/packet.jcs", root), "utf8");
  assert.equal(expectedJcs, PACKET_JCS);
  assert.equal(jcs(packet), PACKET_JCS);
  assert.equal(packetHash(packet), PACKET_HASH);
  assert.equal(sha256Hex(PACKET_JCS), PACKET_HASH);
  assert.equal(jcs({ b: 1, a: 2, nested: { d: 1, c: [true, null] } }), '{"a":2,"b":1,"nested":{"c":[true,null],"d":1}}');
  assert.equal(jcs({ string: "€$\u000f\nA'B\"\\\\\"/" }), "{\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}");
  assert.throws(() => jcs({ n: 1.5 }), /integers/);
  assert.throws(() => jcs({ n: Number.NaN }), /integers/);
  assert.throws(() => jcs({ n: undefined }), /undefined/);
  assert.throws(() => jcs("\uDEAD"), /lone surrogate/);
  assert.throws(() => packetHash({ note: "<PH: channel — Bot Father>" }), /<PH:/);
  assert.throws(() => packetHash({ nested: ["ok", { field: "<PH: row>" }] }), /<PH:/);
  assert.equal(packetHash({ note: "see <PH: later" }).length, 64);

  const declaration = await readFile(new URL("tests/fixtures/owner-approval/run-declaration.md", root), "utf8");
  assert.equal(canonicalRunDeclaration(declaration), RUN_CANONICAL);
  assert.equal(runDeclarationSha256(declaration), RUN_HASH);
  assert.equal(sha256Hex(RUN_CANONICAL), RUN_HASH);
  const body = RUN_CANONICAL.replace(/^iso-run-declaration\/1\n/, "");
  const spaced = body.replace("owner: ISO Workflow Lead", "owner:   ISO \t Workflow   Lead");
  assert.equal(canonicalRunDeclaration(spaced), RUN_CANONICAL);
  const nfd = body.replace("Lead", "Le\u0061\u0301d");
  assert.equal(canonicalRunDeclaration(nfd), RUN_CANONICAL.replace("Lead", "Le\u00e1d"));
  assert.notEqual(runDeclarationSha256(nfd), RUN_HASH);
  assert.throws(() => canonicalRunDeclaration(body.replace("supersedes: none\n", "")), /missing supersedes/);
  assert.throws(() => canonicalRunDeclaration(`${body}run: ISO-RUN-2\n`), /repeats run/);
  assert.throws(() => canonicalRunDeclaration(`${body}note without a label\n`), /unlabeled/);
});

test("approval kinds bind a hash and reject Approve all", () => {
  const request = validateRequest(requestDocument());
  assert.equal(jcs({
    requestId: "iso-req-1",
    key: "merge",
    kind: "merge-deploy",
    title: request.actions[0].title,
    statement: request.actions[0].statement,
    target: request.actions[0].target,
  }), ACTION_JCS);
  assert.equal(request.actions[0].actionHash, ACTION_HASH);
  assert.equal(actionHash({ requestId: "iso-req-1", ...mergeAction() }), ACTION_HASH);
  const card = renderApprovalCard({ ...request.actions[0], requestId: request.requestId });
  const labels = card.blocks.find((block) => block.type === "actions").elements.map((element) => element.text.text);
  assert.deepEqual(labels, ["Approve", "Reject"]);
  assert.equal(labels.includes("Approve all"), false);
  for (const element of card.blocks.find((block) => block.type === "actions").elements) {
    const value = JSON.parse(element.value);
    assert.deepEqual(Object.keys(value).sort(), ["actionHash", "decision", "key", "requestId"]);
    assert.equal(value.actionHash, ACTION_HASH);
    assert.equal(element.value.length < 2000, true);
  }
  assert.throws(() => validateRequest(requestDocument({
    key: "choice",
    kind: "decision",
    title: "Pick one",
    statement: "Choose.",
    target: { options: ["Ship it", "Approve all"] },
  }, "iso-req-2")), /decision target/);
  const decision = validateRequest(requestDocument({
    key: "choice",
    kind: "decision",
    title: "Pick one",
    statement: "Choose.",
    target: { options: ["Ship it", "Hold"] },
  }, "iso-req-2"));
  assert.deepEqual(
    renderApprovalCard({ ...decision.actions[0], requestId: "iso-req-2" }).blocks.find((block) => block.type === "actions").elements.map((element) => element.text.text),
    ["Ship it", "Hold"],
  );
  validateRequest(requestDocument({
    key: "deploy",
    kind: "deploy",
    title: "Redeploy",
    statement: "Redeploy production.",
    target: { vercelTeam: "team", vercelProject: "prj", target: "production" },
  }, "iso-req-3"));
  validateRequest(requestDocument({
    key: "rollback",
    kind: "rollback",
    title: "Roll back",
    statement: "Roll back production.",
    target: { vercelTeam: "team", vercelProject: "prj", target: "production", deploymentId: "dpl_1" },
  }, "iso-req-4"));
  validateRequest(requestDocument({
    key: "page",
    kind: "scope-page-edit",
    title: "Edit the page",
    statement: "Publish v1.1.",
    target: { page: "canonical", fromVersion: "v1", toVersion: "v1.1", textPath: "docs/iso/canonical-v1.1.md", textSha256: "a".repeat(64), headSha40: HEAD },
  }, "iso-req-5"));
  validateRequest(requestDocument({
    key: "run",
    kind: "experiment-run",
    title: "Start ISO-RUN-1",
    statement: "Start the run.",
    target: { rowUrl: "https://app.notion.com/p/iso-run-1", contentSha256: RUN_HASH },
  }, "iso-req-6"));
  validateRequest(requestDocument({
    key: "bootstrap",
    kind: "bootstrap-reconfirm",
    title: "Re-confirm Bootstrap Packet isobp-20261125-01",
    statement: "Re-confirm the packet.",
    target: { packetHash: PACKET_HASH, mergeSha40: HEAD, deploymentId: "dpl_1" },
  }, "iso-req-7"));
  assert.throws(() => validateRequest(requestDocument({
    key: "other",
    kind: "bootstrap-reconfirm",
    title: "Re-confirm",
    statement: "No.",
    target: { packetHash: PACKET_HASH, mergeSha40: HEAD, deploymentId: "dpl_1" },
  }, "iso-req-8")), /bootstrap/);
});

test("a click records one decision and never merges or deploys", async () => {
  const setup = seedReady();
  const button = approveButton(setup.request);
  const result = await handleApprovalClick(click(setup, button));
  assert.equal(result.status, "recorded");
  assert.equal(result.recorded, true);
  assert.equal(result.record.decision, "approve");
  assert.equal(result.record.decidedBy, APPROVER);
  assert.equal(result.record.actionHash, ACTION_HASH);
  assert.equal(result.record.decidedAt, ICT);
  assert.equal(formatIct(NOW), ICT);
  const puts = recordPuts(setup.github.client);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.sha, undefined);
  assert.equal(puts[0].body.branch, RECORDS_BRANCH);
  assert.match(puts[0].path, /\/contents\/approvals\/records\/iso-req-1\/merge\.json$/);
  assertNoMergeOrDeploy(setup.github.client);
  const updates = setup.slack.calls.filter((call) => call.method === "chat.update");
  assert.deepEqual(updates.map((call) => call.body.channel).sort(), [CENTRAL, THREAD].sort());
  assert.equal(updates.every((call) => call.body.text.includes("APPROVED") && call.body.text.includes(ACTION_HASH) && call.body.text.includes(`<@${APPROVER}>`) && call.body.blocks.every((block) => block.type !== "actions")), true);
  const replies = setup.slack.calls.filter((call) => call.method === "chat.postMessage");
  assert.equal(replies.length, 2);
  assert.equal(replies.every((call) => call.body.text.includes(ACTION_HASH)), true);
});

test("the clicker must be U0CFRUV378D and must not be a bot", async () => {
  const other = seedReady();
  const button = approveButton(other.request);
  const refused = await handleApprovalClick(click(other, button, { userId: "U0OTHER", isBot: false }));
  assert.equal(refused.reason, "clicker is not the approver");
  assert.equal(refused.recorded, false);
  assert.equal(recordPuts(other.github.client).length, 0);

  const bot = seedReady();
  const botClick = await handleApprovalClick(click(bot, approveButton(bot.request), { isBot: true }));
  assert.equal(botClick.reason, "bot click");
  assert.equal(recordPuts(bot.github.client).length, 0);

  const lookedUp = seedReady();
  lookedUp.slack = slackDouble({ users: { [APPROVER]: { id: APPROVER, is_bot: true } } });
  seedSlack(lookedUp.slack, lookedUp.refs);
  const disguised = await handleApprovalClick(click(lookedUp, approveButton(lookedUp.request), { isBot: undefined }));
  assert.equal(disguised.reason, "bot click");
  assert.equal(recordPuts(lookedUp.github.client).length, 0);
});

test("wrong card, foreign author, tampered hash, and replay write nothing", async () => {
  const wrong = seedReady();
  const wrongResult = await handleApprovalClick(click(wrong, approveButton(wrong.request), { messageTs: "1700000000.999999" }));
  assert.equal(wrongResult.reason, "wrong card");
  assert.equal(recordPuts(wrong.github.client).length, 0);

  const foreign = seedReady();
  foreign.slack.messages.length = 0;
  seedSlack(foreign.slack, foreign.refs, "U0OTHER");
  const foreignResult = await handleApprovalClick(click(foreign, approveButton(foreign.request)));
  assert.equal(foreignResult.reason, "card not by the bot");
  assert.equal(recordPuts(foreign.github.client).length, 0);

  const tampered = seedReady();
  const button = approveButton(tampered.request);
  const value = JSON.parse(button.value);
  value.actionHash = `${"0".repeat(63)}1`;
  const tamperedResult = await handleApprovalClick(click(tampered, button, { value: JSON.stringify(value) }));
  assert.equal(tamperedResult.reason, "hash mismatch");
  assert.equal(recordPuts(tampered.github.client).length, 0);

  const stale = seedReady();
  const staleRequest = requestDocument();
  staleRequest.actions[0].statement = "A different statement.";
  const blobSha = storeText(stale.github, REQUESTS_BRANCH, "approvals/requests/iso-req-1.json", `${JSON.stringify(staleRequest)}\n`);
  const pending = JSON.parse(stale.github.state.files.get(`${RECORDS_BRANCH}:approvals/pending/iso-req-1.json`));
  pending.blobSha = blobSha;
  storeText(stale.github, RECORDS_BRANCH, "approvals/pending/iso-req-1.json", `${JSON.stringify(pending)}\n`);
  const staleResult = await handleApprovalClick(click(stale, approveButton(stale.request)));
  assert.equal(staleResult.reason, "hash mismatch");
  assert.equal(recordPuts(stale.github.client).length, 0);

  const replay = seedReady();
  const first = await handleApprovalClick(click(replay, approveButton(replay.request)));
  assert.equal(first.recorded, true);
  const second = await handleApprovalClick(click(replay, approveButton(replay.request), { channelId: THREAD, messageTs: THREAD_CARD_TS, threadTs: THREAD_PARENT }));
  assert.equal(second.status, "already-decided");
  assert.equal(second.recorded, false);
  assert.equal(recordPuts(replay.github.client).length, 1);
  assert.match(replay.slack.calls.filter((call) => call.method === "chat.postEphemeral").at(-1).body.text, /Already decided at 2026-11-25T14:00:00.000\+07:00/);
  assertNoMergeOrDeploy(replay.github.client);
});

test("text, reactions, and edits do not record", async () => {
  const setup = seedReady();
  const button = approveButton(setup.request);
  for (const type of ["message", "reaction_added", "message_changed"]) {
    const result = await handleApprovalClick(click(setup, button, { type }));
    assert.equal(result.reason, "not a click");
    assert.equal(result.recorded, false);
  }
  assert.equal(setup.github.client.calls.length, 0);
});

test("one click updates both surfaces and a second click is a no-op", async () => {
  const setup = seedReady();
  const button = approveButton(setup.request);
  const first = await handleApprovalClick(click(setup, button, { channelId: THREAD, messageTs: THREAD_CARD_TS, threadTs: THREAD_PARENT }));
  assert.equal(first.recorded, true);
  const channels = setup.slack.calls.filter((call) => call.method === "chat.update").map((call) => call.body.channel);
  assert.equal(channels.includes(CENTRAL), true);
  assert.equal(channels.includes(THREAD), true);
  const second = await handleApprovalClick(click(setup, button));
  assert.equal(second.status, "already-decided");
  assert.equal(recordPuts(setup.github.client).length, 1);
  assert.match(setup.slack.calls.filter((call) => call.method === "chat.postEphemeral").at(-1).body.text, /Already decided/);
});

test("two simultaneous clicks create exactly one record", async () => {
  const setup = seedReady();
  const button = approveButton(setup.request);
  const [left, right] = await Promise.all([
    handleApprovalClick(click(setup, button)),
    handleApprovalClick(click(setup, button, { channelId: THREAD, messageTs: THREAD_CARD_TS, threadTs: THREAD_PARENT })),
  ]);
  const outcomes = [left.status, right.status].sort();
  assert.deepEqual(outcomes, ["already-decided", "recorded"]);
  assert.equal([left, right].filter((item) => item.recorded).length, 1);
  const puts = recordPuts(setup.github.client);
  assert.equal(puts.length, 2);
  assert.equal(puts.every((call) => call.body.sha === undefined), true);
  const storedRecords = [...setup.github.state.files.entries()].filter(([key]) => key.includes(":approvals/records/"));
  assert.equal(storedRecords.length, 1);
  assert.equal(JSON.parse(storedRecords[0][1]).decision, "approve");
});

test("the first decision option binds and the other option does not write again", async () => {
  const action = {
    key: "choice",
    kind: "decision",
    title: "Pick one",
    statement: "Choose.",
    target: { options: ["Ship it", "Hold"] },
  };
  const setup = seedReady(action, "iso-req-2");
  const elements = renderApprovalCard({ ...setup.request.actions[0], requestId: "iso-req-2" }).blocks.find((block) => block.type === "actions").elements;
  const first = await handleApprovalClick(click(setup, elements[0]));
  assert.equal(first.record.decision, "Ship it");
  const second = await handleApprovalClick(click(setup, elements[1], { channelId: THREAD, messageTs: THREAD_CARD_TS }));
  assert.equal(second.status, "already-decided");
  assert.equal(second.record.decision, "Ship it");
  assert.equal(recordPuts(setup.github.client).length, 1);
});

test("a failed card update still keeps the record and a later click re-renders it", async () => {
  const setup = seedReady();
  let updates = 0;
  const original = setup.slack.request.bind(setup.slack);
  setup.slack.request = async (method, body) => {
    if (method === "chat.update") {
      updates += 1;
      if (updates <= 2) throw new Error("update failed");
    }
    return original(method, body);
  };
  const button = approveButton(setup.request);
  const first = await handleApprovalClick(click(setup, button));
  assert.equal(first.recorded, true);
  assert.equal(first.syncErrors.length, 2);
  const second = await handleApprovalClick(click(setup, button, { channelId: THREAD, messageTs: THREAD_CARD_TS }));
  assert.equal(second.recorded, false);
  assert.equal(recordPuts(setup.github.client).length, 1);
  assert.equal(updates > 2, true);
});

test("connector mode, a missing signing secret, and a non-app identity record nothing", async () => {
  for (const env of [
    { SLACK_SIGNING_SECRET: SECRET, SLACK_CONNECTOR: "connector_123" },
    { SLACK_CONNECTOR: "connector_123" },
    {},
    { SLACK_SIGNING_SECRET: "   " },
  ]) {
    const setup = seedReady();
    const result = await handleApprovalClick(click(setup, approveButton(setup.request), { env }));
    assert.equal(result.reason, "approval route misconfigured", JSON.stringify(env));
    assert.equal(result.recorded, false);
    assert.equal(setup.github.client.calls.length, 0);
    assert.equal(setup.slack.calls.some((call) => call.method === "chat.postEphemeral" && call.body.text === "approval route misconfigured"), true);
  }
  assert.equal(approvalRouteMode({ SLACK_SIGNING_SECRET: SECRET, SLACK_CONNECTOR: "   " }).ok, true);

  for (const identity of [
    { kind: "personal-token", botLogin: "anak", label: "personal-token (anak)" },
    { kind: "github-app", botLogin: "iso-workflows", label: "github-app (iso-workflows)" },
    { kind: "github-connector", botLogin: "iso-workflows[bot]", label: "github-connector (iso-workflows[bot])" },
  ]) {
    const setup = seedReady();
    setup.github.client.identity = identity;
    const result = await handleApprovalClick(click(setup, approveButton(setup.request)));
    assert.equal(result.reason, "personal-token identity");
    assert.equal(recordPuts(setup.github.client).length, 0);
    assertNoMergeOrDeploy(setup.github.client);
  }
});

test("filing posts both surfaces from the pinned blob and the placeholder channel refuses", async () => {
  assert.equal(APPROVAL_CHANNEL_ID, "<channelId>");
  assert.equal(approvalChannelConfigured(), false);
  const blocked = approvalGithub();
  const refused = await fileApprovalRequest({
    requestId: "iso-req-1",
    threadChannel: THREAD,
    threadTs: THREAD_PARENT,
    client: blocked.client,
    slack: slackDouble(),
    env: ENV,
  });
  assert.equal(refused.reason, "approval channel is not configured");
  assert.equal(blocked.client.calls.length, 0);

  const github = approvalGithub();
  const request = validateRequest(requestDocument());
  storeText(github, REQUESTS_BRANCH, "approvals/requests/iso-req-1.json", `${JSON.stringify(request)}\n`);
  const slack = slackDouble();
  const filed = await deliverApprovalRequest({
    requestId: "iso-req-1",
    channelId: CENTRAL,
    threadChannel: THREAD,
    threadTs: THREAD_PARENT,
    client: github.client,
    slack,
    env: ENV,
  });
  assert.equal(filed.status, "filed");
  const posts = slack.calls.filter((call) => call.method === "chat.postMessage");
  assert.deepEqual(posts.map((call) => call.body.channel), [CENTRAL, THREAD]);
  assert.equal(posts[1].body.thread_ts, THREAD_PARENT);
  const pending = JSON.parse(github.state.files.get(`${RECORDS_BRANCH}:approvals/pending/iso-req-1.json`));
  assert.equal(pending.blobSha, sha1(`${JSON.stringify(request)}\n`));
  assert.deepEqual(pending.actions.merge.cardRefs.map((ref) => ref.surface), ["central", "thread"]);
  assert.equal(pending.actions.merge.cardRefs.every((ref) => ref.authorUserId === BOT), true);
  assert.equal([...github.state.files.keys()].some((key) => key.includes(":approvals/records/")), false);
  assertNoMergeOrDeploy(github.client);
  const again = await deliverApprovalRequest({
    requestId: "iso-req-1",
    channelId: CENTRAL,
    threadChannel: THREAD,
    threadTs: THREAD_PARENT,
    client: github.client,
    slack,
    env: ENV,
  });
  assert.equal(again.status, "already-filed");
  assert.equal(slack.calls.filter((call) => call.method === "chat.postMessage").length, 2);

  const connector = await deliverApprovalRequest({
    requestId: "iso-req-1",
    channelId: CENTRAL,
    threadChannel: THREAD,
    threadTs: THREAD_PARENT,
    client: approvalGithub().client,
    slack: slackDouble(),
    env: { SLACK_SIGNING_SECRET: SECRET, SLACK_CONNECTOR: "connector_123" },
  });
  assert.equal(connector.reason, "approval route misconfigured");
});

test("mentions parse only as a filing command and the slack hook stays ahead of the model", async () => {
  assert.equal(parseApprovalRequestMention(`<@${BOT}> approval-request iso-req-1`), "iso-req-1");
  assert.equal(parseApprovalRequestMention("@ISO Workflows approval-request iso-req-1"), "iso-req-1");
  assert.equal(parseApprovalRequestMention("please approve iso-req-1"), null);
  assert.equal(parseApprovalRequestMention("I approve this merge"), null);
  const github = approvalGithub();
  let builds = 0;
  const handlers = createApprovalHandlers({
    createClient: async () => {
      builds += 1;
      return github.client;
    },
    env: () => ENV,
  });
  const slack = slackDouble();
  assert.equal(await handlers.onMessage({ text: "hello", channelId: THREAD }, { slack }), false);
  assert.equal(await handlers.onMessage({ text: `<@${BOT}> approval-request iso-req-1`, channelId: "COTHER" }, { slack }), false);
  assert.equal(await handlers.onMessage({ text: `<@${BOT}> approval-request iso-req-1`, channelId: THREAD }, { slack, edit: { previousText: "x" } }), true);
  assert.equal(builds, 0);
  assert.equal(await handlers.onMessage({ text: `<@${BOT}> approval-request iso-req-1`, channelId: THREAD, threadTs: THREAD_PARENT, ts: THREAD_PARENT }, { slack }), true);
  assert.equal(builds, 1);
  assert.equal(github.client.calls.length, 0);

  const slackSource = await readFile(new URL("agents/specification/agent/channels/slack.ts", root), "utf8");
  const interaction = slackSource.slice(slackSource.indexOf("onInteraction:"));
  const approvalAt = interaction.indexOf('startsWith("iso-approval:")');
  const phaseAt = interaction.indexOf("phaseAnswerFromAction");
  assert.equal(approvalAt > 0 && approvalAt < phaseAt, true);
  const messageAt = slackSource.indexOf("async onMessage");
  const consumeAt = slackSource.indexOf("approvals.onMessage", messageAt);
  const statusAt = slackSource.indexOf('specificationConfig.status !== "approved"', messageAt);
  const authAt = slackSource.indexOf("return { auth }", messageAt);
  assert.equal(consumeAt > messageAt && consumeAt < statusAt && statusAt < authAt, true);
  const moduleSource = await readFile(new URL("lib/owner-approval.mjs", root), "utf8");
  for (const token of ["mergeApprovedPullRequest", "mergeRecordingPullRequest", "assertMergeAuthorized", "api.vercel.com", "/deployments"]) {
    assert.equal(moduleSource.includes(token), false, token);
  }
});

test("the gate approver pin ignores FACTORY_GATE_APPROVER_IDS", () => {
  assert.deepEqual(gateApproverIds({ FACTORY_GATE_APPROVER_IDS: "U0CFRUV378D, UEXTRA" }), [APPROVER]);
  assert.deepEqual(gateApproverIds({ FACTORY_GATE_APPROVER_IDS: "U0OTHER" }), [APPROVER]);
});

test("docs/iso v1.1 files keep the byte rules and the unfilled placeholders", async () => {
  const canonical = await readFile(new URL("docs/iso/canonical-v1.1.md", root));
  const personas = await readFile(new URL("docs/iso/personas-v1.1.md", root));
  for (const bytes of [canonical, personas]) {
    const text = bytes.toString("utf8");
    assert.equal(Buffer.from(text, "utf8").equals(bytes), true);
    assert.equal(text.normalize("NFC"), text);
    assert.equal(bytes.includes(13), false);
    assert.equal(bytes.at(-1), 10);
    assert.equal(bytes.at(-2) === 10, false);
    for (const line of text.split("\n").slice(0, -1)) {
      assert.equal(/[ \t]$/.test(line), false);
    }
  }
  const canonicalText = canonical.toString("utf8");
  assert.equal(canonicalText.includes("<channelId>"), true);
  assert.equal(canonicalText.includes("<approvalRowUrl>"), true);
  assert.equal(sha256Hex(canonical), "4ff04e4d224129a49f7deae586f8f9d49a42f68392df65dd7bd0aff61ba085fb");
  assert.equal(sha256Hex(personas), "1ac8edbdb5f5df9bee4e279919f05288dd480482cbd2d43e449fc35dea43eb4e");
});
