import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { mock } from "node:test";
import { GithubClient } from "../lib/github.mjs";
import { approvalEnv, approvalNow, testClock } from "./approval-clock.mjs";
import { testPins } from "./approval-pins.mjs";
import { PLAN_CHECK_SKIP_FOR_APPROVED_ROUTE as skipTrue } from "./plan-check-skip.mjs";

mock.module(new URL("../lib/approval-pins.mjs", import.meta.url).href, {
  exports: { SHIPPED_PINS: testPins },
});
mock.module(new URL("../lib/approval-clock.mjs", import.meta.url).href, {
  exports: { approvalNow, approvalEnv },
});
mock.module(new URL("../lib/plan-check-skip.mjs", import.meta.url).href, {
  exports: { PLAN_CHECK_SKIP_FOR_APPROVED_ROUTE: skipTrue },
});

const { branchRuleTypes, filledRulesetTemplates } = await import("../lib/ruleset-spec.mjs");
const {
  APPROVAL_CHANNEL_ID,
  APPROVER_SLACK_ID,
  BOT_USER_ID,
  ISO_WORKFLOWS_BOT_ID,
  RECORDS_BRANCH,
  REQUESTS_BRANCH,
  THREAD_SURFACE_CHANNELS,
  fileApprovalRequest: fileApprovalRequestRaw,
  formatIct,
  handleApprovalClick: handleApprovalClickRaw,
  jcs,
  renderApprovalCard,
  routeApprovalCardExpiresAt,
  routeApprovalStatement,
  routeApprovalTitle,
  sha256Hex,
  stepsCanonical,
  validateRequest,
} = await import("../lib/owner-approval.mjs");
const { assessPhase3Gate, sha256 } = await import("../lib/srs-validate.mjs");

const SLACK_APP = testPins.slackAppId;
const BOT = BOT_USER_ID;
const NOW = new Date("2026-11-25T07:00:00.000Z");
const ENV = { SLACK_SIGNING_SECRET: "test-signing-secret" };
const THREAD = THREAD_SURFACE_CHANNELS[0];
const THREAD_PARENT = "1700000000.000050";
const PROJECT = "a".repeat(32);

function applyClock(input) {
  testClock.now = input?.now instanceof Date ? input.now : NOW;
  testClock.env = input?.env ?? ENV;
}

function http(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "OK", async text() { return JSON.stringify(body); } };
}

function sha1(text) {
  return createHash("sha1").update(text).digest("hex");
}

function approvalGithub() {
  const resolved = { kind: "github-app", botLogin: "iso-workflows[bot]", label: "github-app (iso-workflows[bot])" };
  const state = {
    files: new Map(),
    blobs: new Map(),
    history: new Map(),
    authors: new Map(),
    rulesets: filledRulesetTemplates(1).map((template, index) => ({ ...template, id: index + 1, current_user_can_bypass: "never" })),
  };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const key = `${body.branch}:${filePath}`;
      const text = Buffer.from(body.content, "base64").toString("utf8");
      const remember = () => {
        const history = state.history.get(key) ?? [];
        history.unshift({
          sha: sha1(`${history.length}:${text}`),
          text,
          author: { login: resolved.botLogin, id: 1 },
          committer: { login: resolved.botLogin, id: 1 },
          commit: { verification: { verified: true, reason: "valid" } },
        });
        state.history.set(key, history);
      };
      if (body?.sha !== undefined) {
        const current = state.files.get(key);
        if (current == null || body.sha !== sha1(current)) return http({ message: "sha mismatch" }, 409);
        state.files.set(key, text);
        state.authors.set(key, resolved.botLogin);
        state.blobs.set(sha1(text), text);
        remember();
        return http({ content: { sha: sha1(text) } }, 200);
      }
      if (state.files.has(key)) return http({ message: "exists" }, 422);
      state.files.set(key, text);
      state.authors.set(key, resolved.botLogin);
      remember();
      return http({ content: { sha: "d".repeat(40) } }, 201);
    }
    if (method === "GET" && pathname.endsWith("/commits")) {
      const key = `${parsed.searchParams.get("sha")}:${parsed.searchParams.get("path")}`;
      const limit = Number(parsed.searchParams.get("per_page") ?? "1");
      if (state.history.has(key)) {
        const commits = state.history.get(key).slice(0, limit).map((commit) => ({
          ...commit,
          author: { ...commit.author },
          committer: { ...commit.committer },
          commit: { verification: { ...commit.commit.verification } },
        }));
        if (commits.length > 0 && state.authors.has(key)) commits[0].author.login = state.authors.get(key);
        return http(commits);
      }
      const login = state.files.has(key) ? state.authors.get(key) : undefined;
      if (!login) return http([]);
      return http([{
        sha: "c".repeat(40),
        author: { login, id: 1 },
        committer: { login, id: 1 },
        commit: { verification: { verified: true, reason: "valid" } },
      }].slice(0, limit));
    }
    if (method === "GET" && pathname.endsWith("/rulesets")) return http(state.rulesets);
    if (method === "GET" && pathname.includes("/rules/branches/")) {
      const branch = decodeURIComponent(pathname.split("/rules/branches/")[1]);
      return http(branchRuleTypes(branch).map((type) => ({ type })));
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      if (/^[0-9a-f]{40}$/.test(ref ?? "")) {
        for (const [key, commits] of state.history) {
          if (!key.endsWith(`:${filePath}`)) continue;
          const commit = commits.find((item) => item.sha === ref);
          if (!commit?.text) continue;
          const blob = sha1(commit.text);
          state.blobs.set(blob, commit.text);
          return http({ encoding: "base64", content: Buffer.from(commit.text).toString("base64"), sha: blob, type: "file" });
        }
        return http({ message: "Not Found" }, 404);
      }
      const text = state.files.get(`${ref}:${filePath}`);
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
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return {
    state,
    client: new GithubClient({
      fetchImpl,
      token: "test-token",
      owner: "Awannaphasch2016",
      repo: "org-brain",
      identity: resolved,
    }),
  };
}

function slackDouble() {
  const messages = [];
  return {
    messages,
    async request(method, body) {
      if (method === "users.info") return { ok: true, user: { id: body.user, is_bot: false } };
      if (method === "chat.postMessage") {
        const ts = `${1700000000 + messages.length}.000100`;
        messages.push({ channel: body.channel, ts, threadTs: body.thread_ts ?? ts, user: BOT, bot_id: ISO_WORKFLOWS_BOT_ID, app_id: SLACK_APP });
        return { ok: true, ts, channel: body.channel, message: { user: BOT, ts, bot_id: ISO_WORKFLOWS_BOT_ID, app_id: SLACK_APP } };
      }
      if (method === "chat.update" || method === "chat.postEphemeral") return { ok: true, ts: body.ts };
      if (method === "conversations.replies") {
        const found = messages.filter((item) => item.channel === body.channel && (item.ts === body.ts || item.threadTs === body.ts) && (!body.oldest || item.ts >= body.oldest) && (!body.latest || item.ts <= body.latest));
        return { ok: true, messages: found.map((item) => ({ ts: item.ts, user: item.user, bot_id: item.bot_id, app_id: item.app_id })) };
      }
      throw new Error(`unexpected slack ${method}`);
    },
  };
}

function routeRequest(pairs, requestId, extra = {}) {
  const steps = pairs.map(([id, title]) => ({ id, title }));
  const target = {
    project: { id: extra.projectId ?? PROJECT, title: "Demo" },
    steps,
    stepsSha256: sha256Hex(jcs(stepsCanonical(steps))),
    cardExpiresAt: extra.cardExpiresAt ?? routeApprovalCardExpiresAt(NOW),
  };
  const action = {
    key: "route",
    kind: "route-approval",
    title: routeApprovalTitle(target.project),
    statement: routeApprovalStatement(target),
    target,
  };
  return validateRequest({ schema: "iso-approval-request/1", requestId, actions: [action] });
}

async function approve(pairs, requestId) {
  const github = approvalGithub();
  const slack = slackDouble();
  const request = routeRequest(pairs, requestId);
  applyClock({ now: NOW });
  github.state.files.set(`${REQUESTS_BRANCH}:approvals/requests/${requestId}.json`, `${JSON.stringify(request)}\n`);
  const blob = sha1(`${JSON.stringify(request)}\n`);
  github.state.blobs.set(blob, `${JSON.stringify(request)}\n`);
  github.state.authors.set(`${REQUESTS_BRANCH}:approvals/requests/${requestId}.json`, "iso-workflows[bot]");
  const filed = await fileApprovalRequestRaw({
    requestId,
    threadChannel: THREAD,
    threadTs: THREAD_PARENT,
    client: github.client,
    slack,
    now: NOW,
  });
  assert.equal(filed.status, "filed", filed.reason);
  const pending = JSON.parse(github.state.files.get(`${RECORDS_BRANCH}:approvals/pending/${requestId}.json`));
  const central = pending.actions.route.cardRefs.find((ref) => ref.surface === "central");
  const button = renderApprovalCard({ ...request.actions[0], requestId }).blocks.find((block) => block.type === "actions").elements[0];
  applyClock({ now: NOW });
  const clicked = await handleApprovalClickRaw({
    type: "block_actions",
    actionId: button.action_id,
    value: button.value,
    userId: APPROVER_SLACK_ID,
    channelId: central.channel,
    messageTs: central.ts,
    threadTs: central.threadTs,
    client: github.client,
    slack,
  });
  assert.equal(clicked.recorded, true, clicked.reason);
  return { github, request };
}

function projectFor(torText, extra = {}) {
  return {
    tor: {
      status: "approved",
      path: "docs/tor.md",
      baseline: {
        mergeCommit: "b".repeat(40),
        approvedAt: "2026-11-14T08:00:00.000Z",
        approvedBy: "slack:T0TEAM:U0CFRUV378D",
        sha256: sha256(torText),
      },
    },
    ...extra,
  };
}

test("a test-only skip double allows the SRS plan check only for the matching project and exact ordered steps", async () => {
  assert.equal(skipTrue, true);
  const torText = "IS-001 keep a reviewed requirements document\n";
  const ordered = [["tor", "Terms"], ["srs", "Requirements"]];
  const { github, request } = await approve(ordered, "iso-route-skip");
  const action = { ...request.actions[0], requestId: request.requestId };
  const skipped = await assessPhase3Gate({
    project: projectFor(torText),
    torText,
    routeApproval: { client: github.client, action },
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.planCheckSkipped, true);
  assert.equal(skipped.sourcePlanCommit, null);
  assert.equal(skipped.sourcePlanSha256, null);
  assert.equal(skipped.sha256, sha256(torText));

  const cases = [
    [["srs", "Requirements"]],
    [["tor", "Terms"], ["srs", "Requirements"], ["verification", "Check"]],
    [["srs", "Requirements"], ["tor", "Terms"]],
  ];
  for (const pairs of cases) {
    const changed = routeRequest(pairs, request.requestId).actions[0];
    const refused = await assessPhase3Gate({
      project: projectFor(torText),
      torText,
      routeApproval: { client: github.client, action: { ...changed, requestId: request.requestId } },
    });
    assert.equal(refused.reason, "projectPlan-not-approved");
  }
  const other = routeRequest(ordered, request.requestId, { projectId: "b".repeat(32) }).actions[0];
  assert.equal((await assessPhase3Gate({
    project: projectFor(torText),
    torText,
    routeApproval: { client: github.client, action: { ...other, requestId: request.requestId } },
  })).reason, "projectPlan-not-approved");

  const withoutSrs = await approve([["tor", "Terms"], ["plan", "Plan"]], "iso-route-no-srs");
  assert.equal((await assessPhase3Gate({
    project: projectFor(torText),
    torText,
    routeApproval: {
      client: withoutSrs.github.client,
      action: { ...withoutSrs.request.actions[0], requestId: withoutSrs.request.requestId },
    },
  })).reason, "projectPlan-not-approved");

  assert.equal((await assessPhase3Gate({
    project: projectFor(torText),
    torText: "different tor\n",
    routeApproval: { client: github.client, action },
  })).reason, "tor-hash-mismatch");
  assert.equal((await assessPhase3Gate({
    project: projectFor(torText, { srs: { status: "needs-review" } }),
    torText,
    routeApproval: { client: github.client, action },
  })).reason, "srs-needs-review");
  assert.equal(formatIct(NOW).endsWith("+07:00"), true);
  assert.equal(APPROVAL_CHANNEL_ID, "C0CLPUMNYUD");
});
