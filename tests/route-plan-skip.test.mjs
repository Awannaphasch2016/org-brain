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
  APPROVER_SLACK_ID,
  BOT_USER_ID,
  ISO_WORKFLOWS_BOT_ID,
  RECORDS_BRANCH,
  REQUESTS_BRANCH,
  THREAD_SURFACE_CHANNELS,
  fileApprovalRequest: fileApprovalRequestRaw,
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
const { assessPhase3Gate, assessRouteSkip, sha256 } = await import("../lib/srs-validate.mjs");

const SLACK_APP = testPins.slackAppId;
const BOT = BOT_USER_ID;
const NOW = new Date("2026-11-25T07:00:00.000Z");
const ENV = { SLACK_SIGNING_SECRET: "test-signing-secret" };
const THREAD = THREAD_SURFACE_CHANNELS[0];
const THREAD_PARENT = "1700000000.000050";
const PROJECT = "a".repeat(32);
const DASHED = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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

async function approve(pairs, requestId, extra = {}) {
  const github = approvalGithub();
  const slack = slackDouble();
  const request = routeRequest(pairs, requestId, extra);
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
  const project = {
    notionPageId: PROJECT,
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
  };
  for (const key of Object.keys(extra)) {
    if (extra[key] === undefined) delete project[key];
    else project[key] = extra[key];
  }
  return project;
}

function countingClient(client) {
  const calls = [];
  return {
    calls,
    client: {
      owner: client.owner,
      repo: client.repo,
      identity: client.identity,
      request(method, apiPath, init) {
        calls.push({ method, apiPath });
        return client.request(method, apiPath, init);
      },
    },
  };
}

function gate(github, request, project, torText, client = github.client) {
  return assessPhase3Gate({
    project,
    torText,
    routeApproval: {
      client,
      action: { ...request.actions[0], requestId: request.requestId },
    },
  });
}

function actionWithSteps(request, steps) {
  const action = { ...request.actions[0], requestId: request.requestId };
  return {
    ...action,
    target: {
      ...action.target,
      steps,
      stepsSha256: sha256Hex(jcs(stepsCanonical(steps.filter((step) => step && typeof step === "object")))),
    },
  };
}

const TOR_TEXT = "IS-001 keep a reviewed requirements document\n";

test("happy path: approved tor-then-srs route for the gated project skips only the plan check", async () => {
  assert.equal(skipTrue, true);
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-skip");
  const skipped = await gate(github, request, projectFor(TOR_TEXT), TOR_TEXT);
  assert.equal(skipped.ok, true);
  assert.equal(skipped.planCheckSkipped, true);
  assert.equal(skipped.sourcePlanCommit, null);
  assert.equal(skipped.sourcePlanSha256, null);
  assert.equal(skipped.sha256, sha256(TOR_TEXT));

  const longer = await approve(
    [["tor", "Terms"], ["srs", "Requirements"], ["implementation", "Build"], ["verification", "Check"]],
    "iso-route-longer",
  );
  const longerSkip = await gate(longer.github, longer.request, projectFor(TOR_TEXT), TOR_TEXT);
  assert.equal(longerSkip.ok, true);
  assert.equal(longerSkip.planCheckSkipped, true);

  const dashed = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-dashed", { projectId: DASHED });
  const dashedSkip = await assessRouteSkip({
    project: projectFor(TOR_TEXT, { notionPageId: DASHED }),
    routeApproval: {
      client: dashed.github.client,
      action: { ...dashed.request.actions[0], requestId: dashed.request.requestId },
    },
  });
  assert.deepEqual(dashedSkip, { ok: true });
  const dashedGate = await gate(dashed.github, dashed.request, projectFor(TOR_TEXT, { notionPageId: DASHED }), TOR_TEXT);
  assert.equal(dashedGate.planCheckSkipped, true);
});

test("wrong project: a genuinely approved route for project A does not skip project B's plan check", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-wrong");
  const counted = countingClient(github.client);
  const project = projectFor(TOR_TEXT, { notionPageId: "b".repeat(32) });
  const action = { ...request.actions[0], requestId: request.requestId };
  assert.deepEqual(
    await assessRouteSkip({ project, routeApproval: { client: counted.client, action } }),
    { ok: false, reason: "project-mismatch" },
  );
  const refused = await assessPhase3Gate({
    project,
    torText: TOR_TEXT,
    routeApproval: { client: counted.client, action },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "projectPlan-not-approved");
  assert.equal(counted.calls.length, 0);
  const dashedProject = projectFor(TOR_TEXT, { notionPageId: DASHED });
  const dashedCount = countingClient(github.client);
  assert.deepEqual(
    await assessRouteSkip({
      project: dashedProject,
      routeApproval: { client: dashedCount.client, action },
    }),
    { ok: false, reason: "project-mismatch" },
  );
  assert.equal(dashedCount.calls.length, 0);
});

test("missing project id: no notionPageId on the gated project fails closed", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-missing");
  const action = { ...request.actions[0], requestId: request.requestId };
  const cases = [
    projectFor(TOR_TEXT, { notionPageId: undefined }),
    projectFor(TOR_TEXT, { notionPageId: "" }),
    projectFor(TOR_TEXT, { notionPageId: 12345678 }),
    projectFor(TOR_TEXT, { notionPageId: "demo" }),
    projectFor(TOR_TEXT, { id: PROJECT, notionPageId: undefined }),
  ];
  for (const project of cases) {
    const counted = countingClient(github.client);
    assert.equal(
      (await assessRouteSkip({ project, routeApproval: { client: counted.client, action } })).reason,
      "project-id-missing",
    );
    assert.equal((await assessPhase3Gate({
      project,
      torText: TOR_TEXT,
      routeApproval: { client: counted.client, action },
    })).reason, "projectPlan-not-approved");
    assert.equal(counted.calls.length, 0);
  }
});

test("tor before srs with steps between them is allowed", async () => {
  for (const [pairs, requestId] of [
    [[["tor", "Terms"], ["plan", "Plan"], ["srs", "Requirements"]], "iso-route-between-plan"],
    [[["tor", "Terms"], ["implementation", "Build"], ["srs", "Requirements"]], "iso-route-between-build"],
  ]) {
    const approved = await approve(pairs, requestId);
    const project = projectFor(TOR_TEXT);
    const action = { ...approved.request.actions[0], requestId: approved.request.requestId };
    assert.deepEqual(
      await assessRouteSkip({ project, routeApproval: { client: approved.github.client, action } }),
      { ok: true },
    );
    const skipped = await gate(approved.github, approved.request, project, TOR_TEXT);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.planCheckSkipped, true);
  }
});

test("srs before tor is refused", async () => {
  for (const [pairs, requestId] of [
    [[["srs", "Requirements"], ["tor", "Terms"]], "iso-route-srs-first"],
    [[["srs", "Requirements"], ["plan", "Plan"], ["tor", "Terms"]], "iso-route-srs-plan-tor"],
  ]) {
    const approved = await approve(pairs, requestId);
    const project = projectFor(TOR_TEXT);
    const action = { ...approved.request.actions[0], requestId: approved.request.requestId };
    assert.equal(
      (await assessRouteSkip({ project, routeApproval: { client: approved.github.client, action } })).reason,
      "tor-not-before-srs",
    );
    assert.equal((await gate(approved.github, approved.request, project, TOR_TEXT)).reason, "projectPlan-not-approved");
  }
});

test("a route with no tor is refused", async () => {
  for (const [pairs, requestId] of [
    [[["srs", "Requirements"]], "iso-route-srs-only"],
    [[["plan", "Plan"], ["srs", "Requirements"], ["implementation", "Build"]], "iso-route-no-tor"],
  ]) {
    const approved = await approve(pairs, requestId);
    const action = { ...approved.request.actions[0], requestId: approved.request.requestId };
    const { verifyApproval } = await import("../lib/owner-approval.mjs");
    assert.equal((await verifyApproval({ client: approved.github.client, action })).ok, true);
    assert.equal(
      (await assessRouteSkip({
        project: projectFor(TOR_TEXT),
        routeApproval: { client: approved.github.client, action },
      })).reason,
      "tor-missing",
    );
    assert.equal((await gate(approved.github, approved.request, projectFor(TOR_TEXT), TOR_TEXT)).reason, "projectPlan-not-approved");
  }
});

test("a route with no srs is refused", async () => {
  for (const [pairs, requestId] of [
    [[["tor", "Terms"], ["plan", "Plan"]], "iso-route-tor-plan"],
    [[["tor", "Terms"]], "iso-route-tor-only"],
  ]) {
    const approved = await approve(pairs, requestId);
    const action = { ...approved.request.actions[0], requestId: approved.request.requestId };
    assert.equal(
      (await assessRouteSkip({
        project: projectFor(TOR_TEXT),
        routeApproval: { client: approved.github.client, action },
      })).reason,
      "srs-missing",
    );
    assert.equal((await gate(approved.github, approved.request, projectFor(TOR_TEXT), TOR_TEXT)).reason, "projectPlan-not-approved");
  }
});

test("unknown step id is refused by the hook itself", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-unknown");
  for (const id of ["merge-deploy", "TOR", ""]) {
    const steps = [
      { id: "tor", title: "Terms" },
      { id: "srs", title: "Requirements" },
      { id, title: "Merge" },
    ];
    const counted = countingClient(github.client);
    const result = await assessRouteSkip({
      project: projectFor(TOR_TEXT),
      routeApproval: { client: counted.client, action: actionWithSteps(request, steps) },
    });
    assert.equal(result.reason, "route-steps-invalid");
    assert.equal(counted.calls.length, 0);
  }
});

test("duplicate step id is refused by the hook itself", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-dup");
  const cases = [
    [{ id: "tor", title: "Terms" }, { id: "srs", title: "Requirements" }, { id: "tor", title: "Terms again" }],
    "not-an-array",
    [],
    [{ id: "tor", title: "Terms" }, null],
  ];
  for (const steps of cases) {
    const counted = countingClient(github.client);
    const action = steps === "not-an-array"
      ? { ...request.actions[0], requestId: request.requestId, target: { ...request.actions[0].target, steps } }
      : actionWithSteps(request, steps);
    assert.equal(
      (await assessRouteSkip({
        project: projectFor(TOR_TEXT),
        routeApproval: { client: counted.client, action },
      })).reason,
      "route-steps-invalid",
    );
    assert.equal(counted.calls.length, 0);
  }
});

test("verifyApproval is still required: an unfiled or tampered route does not skip", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["plan", "Plan"], ["srs", "Requirements"]], "iso-route-verified");
  const counted = countingClient(github.client);
  const unfiled = routeRequest([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-never");
  assert.equal(
    (await assessRouteSkip({
      project: projectFor(TOR_TEXT),
      routeApproval: {
        client: counted.client,
        action: { ...unfiled.actions[0], requestId: unfiled.requestId },
      },
    })).reason,
    "approval-not-verified",
  );
  assert.ok(counted.calls.length > 0);
  const variants = [
    [["tor", "Terms"], ["srs", "Requirements"]],
    [["tor", "Terms"], ["plan", "Plan"], ["srs", "Requirements"], ["verification", "Check"]],
    [["plan", "Plan"], ["tor", "Terms"], ["srs", "Requirements"]],
  ];
  for (const pairs of variants) {
    const changed = routeRequest(pairs, request.requestId);
    const result = await assessRouteSkip({
      project: projectFor(TOR_TEXT),
      routeApproval: {
        client: github.client,
        action: { ...changed.actions[0], requestId: request.requestId },
      },
    });
    assert.equal(result.reason, "approval-not-verified");
    assert.equal((await gate(github, changed, projectFor(TOR_TEXT), TOR_TEXT)).reason, "projectPlan-not-approved");
  }
});

test("TOR-hash mismatch and srs-needs-review still refuse even with a valid skip", async () => {
  const { github, request } = await approve([["tor", "Terms"], ["srs", "Requirements"]], "iso-route-other-gates");
  assert.equal((await gate(github, request, projectFor(TOR_TEXT), "different tor\n")).reason, "tor-hash-mismatch");
  assert.equal((await gate(
    github,
    request,
    projectFor(TOR_TEXT, { srs: { status: "needs-review" } }),
    TOR_TEXT,
  )).reason, "srs-needs-review");
});
