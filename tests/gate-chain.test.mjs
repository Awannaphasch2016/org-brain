import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { recordBaseline } from "../lib/baseline.mjs";
import { deferGateChain, nextPhaseFor, RECORDING_POINTER_KIND, renderTransition, runApprovedGateChain, TRANSITION_KIND } from "../lib/gate-chain.mjs";
import { deliverPhaseOutput, handleSpecificationInbound, renderThreadProjectBinding } from "../lib/orchestrator.mjs";
import { continuePhaseSession, readPhaseReply, startPhaseAgent } from "../lib/phase-hop.mjs";
import { GithubClient, mergeRecordingPullRequest, recordApprovedBaseline } from "../lib/github.mjs";
import { writeLoadedFiles } from "../lib/project-files.mjs";
import { parseSimpleYaml } from "../lib/project-yaml.mjs";
import { renderStarterProjectYaml } from "../lib/project-setup.mjs";
import { renderSrsGateCard, renderSrsGateNote } from "../lib/srs-gate.mjs";
import { IDENTITY } from "./gate-harness.mjs";

test("a manual recording fallback reuses the chain pointer and does not open another pull request", async () => {
  for (const kind of [RECORDING_POINTER_KIND, TRANSITION_KIND]) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const method = String(init.method ?? "GET").toUpperCase();
      const pathname = new URL(url).pathname;
      calls.push(`${method} ${pathname}`);
      if (method === "GET" && pathname.endsWith("/issues/12/comments")) {
        return http([{ id: 1, body: fenced(kind, { idempotencyKey: "gate:tor", recordingPr: 31 }), user: { login: IDENTITY.botLogin } }]);
      }
      return http({ message: `unhandled ${method} ${pathname}` }, 500);
    };
    const client = new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r", identity: IDENTITY });
    await assert.rejects(
      () => recordApprovedBaseline(client, {
        projectId: "demo",
        pullNumber: 12,
        block: "tor",
        stamp: "20261116T020000Z",
        allowedUserIds: ["U0CFRUV378D"],
        signingSecret: "test-signing-secret",
      }),
      /recording pull request already opened/,
    );
    assert.deepEqual(calls, ["GET /repos/o/r/issues/12/comments"]);
  }
});

test("the Slack ack returns before the recording poll starts", async () => {
  let started = false;
  let acked = false;
  deferGateChain(() => {}, async () => {
    started = true;
  });
  acked = true;
  assert.equal(acked, true);
  assert.equal(started, false);
  await Promise.resolve();
  assert.equal(started, true);
  const gate = await readFile(new URL("../lib/slack-gate.ts", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const eve = await readFile(new URL("../node_modules/eve/dist/src/internal/nitro/host/vercel-build-output-config.js", import.meta.url), "utf8");
  assert.match(gate, /return deferGateChain\(\(\) => \{\}/);
  assert.equal(gate.includes("await deferGateChain"), false);
  assert.equal(gate.includes("await runApprovedGateChain"), true);
  assert.equal(vercel.maxDuration, undefined);
  assert.equal(vercel.functions, undefined);
  assert.match(eve, /maxDuration:`max`/);
  const interactions = await readFile(new URL("../node_modules/eve/dist/src/public/channels/slack/interactions.js", import.meta.url), "utf8");
  assert.match(interactions, /waitUntil\(dispatchCustomInteractions/);
});

function fenced(kind, record) {
  return ["```json", JSON.stringify({ schema: 1, kind, ...record }, null, 2), "```", ""].join("\n");
}

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

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const RECORD = "d".repeat(40);

test("next phase is a pure function and does not start another agent", () => {
  assert.equal(nextPhaseFor("tor"), "project-planner");
  assert.equal(nextPhaseFor("project-plan"), "specification");
  assert.equal(nextPhaseFor("srs"), null);
});

test("an approved gate records one baseline, merges it, and writes one transition", async () => {
  for (const stage of ["tor", "project-plan", "srs"]) {
    const harness = chainClient();
    const recorded = [];
    const merged = [];
    const first = await runApprovedGateChain({
      client: harness.client,
      decision: decision(stage),
      allowedUserIds: ["U0CFRUV378D"],
      signingSecret: "test-signing-secret",
      intervalMs: 10_000,
      timeoutMs: 50_000,
      now: () => harness.clock,
      sleep: async (ms) => {
        harness.clock += ms;
        harness.ci = "success";
      },
      recordBaseline: async (client, input) => {
        recorded.push({ block: input.block, identity: client.identity.kind });
        return { number: 31 };
      },
      mergeRecording: async (client, input) => {
        merged.push({ number: input.pullNumber, identity: client.identity.label });
        harness.pulls[31].merged = true;
        return { merged: true };
      },
      startAgent: async ({ agent, message }) => ({ agent, sessionId: `sess-${agent}`, tool: message, url: `https://factory.example/eve/${agent}/v1/session` }),
    });
    assert.equal(first.status, "transitioned");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].identity, "github-app");
    assert.equal(merged.length, 1);
    assert.match(merged[0].identity, /factory\[bot\]/);
    assert.equal(first.event.completedStage, stage);
    assert.equal(first.event.next, nextPhaseFor(stage));
    assert.equal(first.event.baselineMergeCommit, MERGE);
    if (stage === "srs") assert.equal(first.notices.at(-1).text, "iteration complete");
    assert.equal(first.notices.some((notice) => notice.blocks?.length), false);
    const cold = chainClient({ comments: harness.comments[12].map((comment) => ({ ...comment })) });
    const second = await runApprovedGateChain({
      client: cold.client,
      decision: decision(stage),
      startAgent: async ({ agent, message }) => ({ agent, sessionId: `sess-${agent}`, tool: message, url: `https://factory.example/eve/${agent}/v1/session` }),
      recordBaseline: async () => {
        recorded.push({ again: true });
        return { number: 99 };
      },
      mergeRecording: async () => {
        merged.push({ again: true });
      },
    });
    assert.equal(second.status, "already-transitioned");
    assert.equal(second.event, null);
    assert.equal(recorded.length, 1);
    assert.equal(merged.length, 1);
  }
});

test("recording merge waits for CI and fails closed without a transition", async () => {
  const pending = chainClient();
  const waited = [];
  const pendingResult = await runApprovedGateChain({
    client: pending.client,
    decision: decision("tor"),
    intervalMs: 10_000,
    timeoutMs: 20_000,
    now: () => pending.clock,
    sleep: async (ms) => {
      pending.clock += ms;
      waited.push(ms);
    },
    recordBaseline: async () => ({ number: 31 }),
    mergeRecording: mergeRecordingPullRequest,
  });
  assert.deepEqual(waited, [10_000, 10_000]);
  assert.equal(pendingResult.status, "ci-blocked");
  assert.equal(pendingResult.event, null);
  assert.equal(pendingResult.notices[0].text, "recording PR #31 not merged: CI pending");
  assert.equal(pending.comments[12].some((comment) => comment.body.includes(TRANSITION_KIND)), false);

  const failing = chainClient({ ci: "failure" });
  const failed = await runApprovedGateChain({
    client: failing.client,
    decision: decision("srs"),
    intervalMs: 10_000,
    timeoutMs: 50_000,
    now: () => 0,
    sleep: async () => {
      throw new Error("should not retry a red check");
    },
    recordBaseline: async () => ({ number: 31 }),
    mergeRecording: async () => {
      throw new Error("merge should not run");
    },
  });
  assert.equal(failed.status, "ci-blocked");
  assert.equal(failed.event, null);
  assert.equal(failed.notices[0].text, "recording PR #31 not merged: CI failure");
  assert.equal(failed.notices[0].blocks.length, 0);
});

test("SRS approval fields come from the decision and the document has no draft status", () => {
  const yaml = renderStarterProjectYaml({
    id: "demo",
    title: "Demo",
    uploader: "slack:T0TEAM:U0CFRUV378D",
    uploadedAt: "2026-11-16T00:00:00.000Z",
    slackFileId: "F1",
    sourceSha256: "ab".repeat(32),
    mediaType: "text/markdown",
  });
  const approvedBy = "slack:T0TEAM:U0CFRUV378D";
  const approvedAt = "2026-11-16T01:00:00.000Z";
  const next = recordBaseline(yaml, "srs", {
    pullNumber: 4,
    mergeCommit: MERGE,
    approvedBy,
    approvedAt,
    extra: {
      sha256: "cd".repeat(32),
      sourceTorCommit: HEAD,
      sourcePlanCommit: RECORD,
      sourcePlanSha256: "ef".repeat(32),
    },
  });
  const project = parseSimpleYaml(next);
  assert.equal(project.srs.status, "approved");
  assert.equal(project.srs.baseline.approvedAt, approvedAt);
  assert.equal(project.srs.baseline.approvedBy, approvedBy);
  const srs = "# Introduction\n\nReady.\n";
  assert.equal(/Status:\s*Draft/i.test(srs), false);
  assert.equal(/Status:\s*Draft/i.test(next), false);
});

test("the SRS card shows section status, validation, coverage, and the pull request link", () => {
  const srs = [
    "# Introduction",
    "Intro",
    "# Scope",
    "Scope",
    "# Functional Requirements",
    "## FR-001",
    "Source: IS-001",
    "# Nonfunctional Requirements",
    "## NFR-001",
    "Source: IS-002",
    "# Acceptance Criteria",
    "Accept",
    "# Constraints and References",
    "None",
  ].join("\n");
  const tor = "IS-001 keep\nIS-002 keep\nIS-003 later\n";
  const url = "https://github.com/o/r/pull/8";
  const note = renderSrsGateNote({ srs, torText: tor, validationOk: true, url });
  assert.equal(
    note,
    [
      "Introduction: present",
      "Scope: present",
      "Functional Requirements: present",
      "Nonfunctional Requirements: present",
      "Acceptance Criteria: present",
      "Constraints and References: present",
      "Validation: pass",
      "IS coverage: 2/3",
      url,
    ].join("\n"),
  );
  const card = renderSrsGateCard({ projectId: "demo", repo: "o/r", pr: 8, headSha: HEAD, note });
  assert.match(JSON.stringify(card.blocks), /Validation: pass/);
  assert.match(JSON.stringify(card.blocks), /IS coverage: 2\/3/);
  assert.match(JSON.stringify(card.blocks), /https:\/\/github.com\/o\/r\/pull\/8/);
  assert.equal(renderTransition({ projectId: "demo", completedStage: "tor", next: "project-planner" }).includes(TRANSITION_KIND), true);
});

test("load_project leaves a different local SRS draft unchanged", async () => {
  const files = { "projects/demo/docs/srs.md": "loaded from base\n", "projects/demo/project.yaml": "id: demo\n" };
  const written = {};
  const sandbox = {
    async readTextFile({ path }) {
      if (path.endsWith("srs.md")) return "local draft\n";
      return null;
    },
    async writeTextFile({ path, content }) {
      written[path] = content;
    },
  };
  const conflict = await writeLoadedFiles(sandbox, files);
  assert.deepEqual(conflict, ["projects/demo/docs/srs.md"]);
  assert.equal(written["projects/demo/docs/srs.md"], undefined);
  assert.equal(written["projects/demo/project.yaml"], "id: demo\n");
});

test("runApprovedGateChain starts the next agent from the durable transition record", async () => {
  const torYaml = `id: demo
status: active
tor:
  status: approved
projectPlan:
  status: none
srs:
  status: none
`;
  const planYaml = `id: demo
status: active
tor:
  status: approved
projectPlan:
  status: approved
srs:
  status: none
`;
  const calls = [];
  const startAgent = (input) => startPhaseAgent({
    ...input,
    env: { VERCEL_URL: "factory.example" },
    auth: { authorization: "Bearer test" },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const agent = url.split("/eve/")[1].split("/")[0];
      return {
        ok: true,
        async json() {
          return { sessionId: `sess-${agent}`, deliveryId: `del-${agent}` };
        },
      };
    },
  });
  const tor = chainClient({ projectYaml: torYaml, ci: "success" });
  const torResult = await runApprovedGateChain({
    client: tor.client,
    decision: decision("tor"),
    allowedUserIds: ["U0CFRUV378D"],
    signingSecret: "test-signing-secret",
    startAgent,
    recordBaseline: async () => ({ number: 31 }),
    mergeRecording: async () => {
      tor.pulls[31].merged = true;
    },
  });
  assert.equal(torResult.status, "transitioned");
  assert.equal(torResult.event.next, "project-planner");
  assert.equal(torResult.handoff.invoked.agent, "project-planner");
  assert.equal(torResult.handoff.invoked.sessionId, "sess-project-planner");
  assert.equal(torResult.handoff.invoked.tool, "load_plan_workspace");
  assert.equal(calls[0].url, "https://factory.example/eve/project-planner/v1/session");
  assert.match(calls[0].body.message, /load_plan_workspace/);
  assert.equal(torResult.handoff.messages.some((message) => message.role === "user"), false);

  const plan = chainClient({ projectYaml: planYaml, ci: "success" });
  const planResult = await runApprovedGateChain({
    client: plan.client,
    decision: decision("project-plan"),
    allowedUserIds: ["U0CFRUV378D"],
    signingSecret: "test-signing-secret",
    startAgent,
    recordBaseline: async () => ({ number: 31 }),
    mergeRecording: async () => {
      plan.pulls[31].merged = true;
    },
  });
  assert.equal(planResult.status, "transitioned");
  assert.equal(planResult.event.next, "specification");
  assert.equal(planResult.handoff.invoked.sessionId, "sess-specification");
  assert.equal(planResult.handoff.invoked.tool, "load_project");
  assert.equal(calls.at(-1).url, "https://factory.example/eve/specification/v1/session");
  assert.match(calls.at(-1).body.message, /load_project/);
});

test("setup on the gate chain starts the TOR session", async () => {
  const calls = [];
  const harness = chainClient({ ci: "success" });
  const result = await runApprovedGateChain({
    client: harness.client,
    decision: decision("setup"),
    startAgent: (input) => startPhaseAgent({
      ...input,
      env: { VERCEL_URL: "factory.example" },
      auth: { authorization: "Bearer test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "del-tor" }; } };
      },
    }),
  });
  assert.equal(result.status, "transitioned");
  assert.equal(result.event.next, "tor");
  assert.equal(result.handoff.invoked.tool, "load_tor_workspace");
  assert.equal(calls[0].url, "https://factory.example/eve/tor/v1/session");
  assert.match(calls[0].body.message, /load_tor_workspace/);
  assert.match(result.handoff.binding, /factory-thread-project/);
  assert.match(result.handoff.binding, /sess-tor/);
});

test("a bound peer session posts its reply and a follow-up returns to that session", async () => {
  const calls = [];
  const posts = [];
  const env = { VERCEL_URL: "factory.example" };
  const auth = { authorization: "Bearer test" };
  let replyText = "What is the objective?";
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (method === "POST" && url.endsWith("/v1/session")) {
      return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "d1" }; } };
    }
    if (method === "GET" && url.endsWith("/stream")) return replyStream(replyText);
    if (method === "POST" && url.endsWith("/sess-tor")) {
      return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "d2" }; } };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const harness = chainClient({ ci: "success" });
  const result = await runApprovedGateChain({
    client: harness.client,
    decision: decision("setup"),
    threadTs: "1.2",
    startAgent: (input) => startPhaseAgent({ ...input, env, auth, fetchImpl }),
    readReply: (invoked) => readPhaseReply({ ...invoked, env, auth, fetchImpl }),
  });
  await deliverPhaseOutput({
    binding: result.handoff.binding,
    reply: result.handoff.reply,
    threadTs: "1.2",
    post: async (payload) => posts.push(payload),
  });
  assert.equal(result.handoff.invoked.sessionId, "sess-tor");
  assert.equal(posts[0].threadTs, "1.2");
  assert.match(posts[0].text, /"sessionId": "sess-tor"/);
  assert.deepEqual(posts[1], { text: "What is the objective?", threadTs: "1.2" });
  replyText = "I will draft the TOR from that objective.";
  const follow = await handleSpecificationInbound({
    projectState: { id: "demo", status: "active", tor: { status: "none" }, projectPlan: { status: "none" }, srs: { status: "none" } },
    text: "Task tracking for a small team",
    threadMessages: [{ text: posts[0].text }],
    startAgent: async () => { throw new Error("duplicate session"); },
    continueAgent: (input) => continuePhaseSession({ ...input, env, auth, fetchImpl }),
    readReply: (invoked) => readPhaseReply({ ...invoked, env, auth, fetchImpl }),
  });
  await deliverPhaseOutput({
    reply: follow.reply,
    threadTs: "1.2",
    post: async (payload) => posts.push(payload),
  });
  assert.equal(follow.resumed, true);
  assert.equal(follow.invoked.sessionId, "sess-tor");
  assert.equal(posts.at(-1).text, "I will draft the TOR from that objective.");
  assert.equal(posts.at(-1).threadTs, "1.2");
  assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith("/v1/session")).length, 1);
  assert.equal(calls.find((call) => call.method === "POST" && call.url.endsWith("/sess-tor")).body.message, "Task tracking for a small team");
  const slack = await readFile(new URL("../agents/specification/agent/channels/slack.ts", import.meta.url), "utf8");
  const gate = await readFile(new URL("../lib/slack-gate.ts", import.meta.url), "utf8");
  assert.match(slack, /continuePhaseSession/);
  assert.match(slack, /deliverPhaseOutput/);
  assert.match(gate, /deliverPhaseOutput/);
  assert.match(gate, /readPhaseReply/);
});

test("a failed hop starts on the next chain call and a second call does not", async () => {
  const harness = chainClient({ ci: "success" });
  const starts = [];
  const startAgent = async ({ agent }) => {
    starts.push(agent);
    if (starts.length === 1) throw new Error("hop failed");
    return { agent, sessionId: "sess-once", tool: "load_tor_workspace", url: "https://factory.example/eve/tor/v1/session" };
  };
  const first = await runApprovedGateChain({
    client: harness.client,
    decision: decision("setup"),
    threadTs: "1.2",
    startAgent,
  });
  assert.equal(first.status, "session-pending");
  assert.equal(first.handoff.invoked, null);
  assert.match(first.handoff.binding, /"sessionId": null/);
  const second = await runApprovedGateChain({
    client: harness.client,
    decision: decision("setup"),
    threadTs: "1.2",
    startAgent,
  });
  assert.equal(second.handoff.invoked.sessionId, "sess-once");
  assert.equal(second.handoff.started, true);
  const third = await runApprovedGateChain({
    client: harness.client,
    decision: decision("setup"),
    threadTs: "1.2",
    startAgent,
  });
  assert.equal(third.status, "already-transitioned");
  assert.equal(third.handoff, null);
  assert.deepEqual(starts, ["tor", "tor"]);
  assert.equal(harness.comments[12].filter((comment) => comment.body.includes("sess-once")).length, 1);
});

test("a thread message starts a missing phase session once", async () => {
  const stored = [];
  const starts = [];
  const pending = renderThreadProjectBinding({
    projectId: "demo",
    agent: "tor",
    sessionId: null,
    idempotencyKey: "gate:setup",
    pr: 12,
    threadTs: "1.2",
  });
  const projectState = { id: "demo", status: "active", tor: { status: "none" }, projectPlan: { status: "none" }, srs: { status: "none" } };
  const startAgent = async ({ agent }) => {
    starts.push(agent);
    return { agent, sessionId: "sess-thread", tool: "load_tor_workspace", url: "https://factory.example/eve/tor/v1/session" };
  };
  const recordSession = async (record) => {
    const existing = stored.find((item) => item.idempotencyKey === record.idempotencyKey && item.sessionId);
    if (existing) return existing;
    if (!record.sessionId) return null;
    stored.push(record);
    return record;
  };
  const first = await handleSpecificationInbound({
    projectState,
    text: "continue",
    threadMessages: [{ text: pending }],
    startAgent,
    recordSession,
    readReply: async () => "Which objective?",
  });
  const second = await handleSpecificationInbound({
    projectState,
    text: "task tracking",
    threadMessages: [{ text: first.binding }],
    startAgent,
    recordSession,
    continueAgent: async (input) => ({ agent: input.agent, sessionId: input.sessionId, tool: "load_tor_workspace" }),
    readReply: async () => "Drafting.",
  });
  const third = await handleSpecificationInbound({
    projectState,
    text: "again",
    threadMessages: [{ text: pending }],
    startAgent,
    recordSession,
    continueAgent: async (input) => ({ agent: input.agent, sessionId: input.sessionId, tool: "load_tor_workspace" }),
    readReply: async () => "",
  });
  assert.equal(first.invoked.sessionId, "sess-thread");
  assert.equal(second.resumed, true);
  assert.equal(second.invoked.sessionId, "sess-thread");
  assert.equal(third.resumed, true);
  assert.equal(third.invoked.sessionId, "sess-thread");
  assert.deepEqual(starts, ["tor"]);
});

function replyStream(text) {
  const line = `${JSON.stringify({
    at: "2026-11-23T00:00:00.000Z",
    facts: [
      { type: "content.completed", data: { kind: "text", phase: "reply", value: text } },
      { type: "turn.settled", data: { outcome: "completed" } },
    ],
  })}\n`;
  const encoded = new TextEncoder().encode(line);
  return {
    ok: true,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoded };
          },
          async cancel() {
            sent = true;
          },
        };
      },
    },
  };
}

test("Phase 1-3 tools no longer prompt and the later phases still do", async () => {
  const removed = {
    "agents/tor/agent/tools/create_tor_pull_request.ts": "Gate 1 card",
    "agents/tor/agent/tools/record_tor_baseline.ts": "verified decision + recording check",
    "agents/project-planner/agent/tools/create_project_plan_pull_request.ts": "Gate 2 card",
    "agents/project-planner/agent/tools/record_project_plan_baseline.ts": "verified decision",
    "agents/specification/agent/tools/create_srs_pull_request.ts": "Gate 3 card",
    "agents/specification/agent/tools/record_srs_baseline.ts": "verified decision",
    "agents/tor/agent/tools/create_project.ts": "setup card",
    "agents/tor/agent/tools/reject_project.ts": "recorded reject decision",
  };
  const keep = [];
  for (const [path, reason] of Object.entries(removed)) {
    assert.equal(typeof reason, "string");
    assert.equal((await readFile(new URL(`../${path}`, import.meta.url), "utf8")).includes("approval: always()"), false, path);
  }
  assert.deepEqual(keep, []);
  for (const agent of ["tor", "project-planner", "specification"]) {
    const text = await readFile(new URL(`../agents/${agent}/agent/agent.ts`, import.meta.url), "utf8");
    assert.equal(text.includes("user-approval"), false, agent);
    const tools = await readdir(new URL(`../agents/${agent}/agent/tools/`, import.meta.url));
    for (const tool of tools.filter((name) => name.endsWith(".ts"))) {
      const text = await readFile(new URL(`../agents/${agent}/agent/tools/${tool}`, import.meta.url), "utf8");
      assert.equal(text.includes("approval: always()"), false, tool);
    }
  }
  const later = ["architecture", "planning", "implementation", "change-control", "release"];
  const prompted = [];
  for (const agent of later) {
    const tools = await readdir(new URL(`../agents/${agent}/agent/tools/`, import.meta.url));
    for (const tool of tools.filter((name) => name.endsWith(".ts"))) {
      const text = await readFile(new URL(`../agents/${agent}/agent/tools/${tool}`, import.meta.url), "utf8");
      if (text.includes("approval: always()")) prompted.push(`${agent}/${tool}`);
    }
  }
  assert.deepEqual(prompted.sort(), [
    "architecture/create_architecture_pull_request.ts",
    "architecture/record_architecture_baseline.ts",
    "change-control/create_change_pull_request.ts",
    "change-control/record_change_baseline.ts",
    "implementation/create_implementation_pull_request.ts",
    "implementation/record_implementation_baseline.ts",
    "planning/create_github_issues.ts",
    "planning/create_issue_plan_pull_request.ts",
    "planning/record_planning_baseline.ts",
    "release/deploy_application.ts",
    "release/prepare_release.ts",
  ]);
});

function decision(stage) {
  return {
    stage,
    projectId: "demo",
    pr: 12,
    headSha: HEAD,
    decidedAt: "2026-11-16T02:00:00.000Z",
    idempotencyKey: `gate:${stage}`,
  };
}

function chainClient({ comments = [], ci = "pending", projectYaml = "" } = {}) {
  const state = {
    clock: 0,
    ci,
    comments: { 12: comments.map((comment) => ({ ...comment })) },
    pulls: {
      12: {
        number: 12,
        state: "closed",
        merged: true,
        merge_commit_sha: MERGE,
        html_url: "https://github.com/o/r/pull/12",
        head: { sha: HEAD, ref: "tor/demo/stamp" },
        base: { sha: "c".repeat(40) },
        body: "",
      },
      31: {
        number: 31,
        state: "open",
        merged: false,
        merge_commit_sha: null,
        html_url: "https://github.com/o/r/pull/31",
        head: { sha: RECORD, ref: "tor/demo/baseline/stamp" },
        base: { sha: "c".repeat(40) },
        body: "",
      },
    },
  };
  const client = {
    owner: "o",
    repo: "r",
    identity: IDENTITY,
    async request(method, path) {
      if (method === "GET" && /\/issues\/\d+\/comments$/.test(path)) {
        const number = Number(path.match(/\/issues\/(\d+)\/comments$/)[1]);
        return state.comments[number] ?? [];
      }
      if (method === "POST" && path.endsWith("/issues/12/comments")) {
        const body = arguments[2]?.body?.body ?? "";
        const comment = { id: state.comments[12].length + 1, body, user: { login: IDENTITY.botLogin } };
        state.comments[12].push(comment);
        return comment;
      }
      if (method === "GET" && /\/pulls\/\d+\/(reviews|comments)$/.test(path)) return [];
      const pull = path.match(/\/pulls\/(\d+)$/);
      if (method === "GET" && pull) return state.pulls[Number(pull[1])];
      if (method === "GET" && path.includes("/status")) return { state: state.ci === "success" ? "success" : "pending" };
      if (projectYaml && method === "GET" && path === "/repos/o/r") return { default_branch: "main" };
      if (projectYaml && method === "GET" && path.includes("/contents/projects/demo/project.yaml")) {
        return { encoding: "base64", content: Buffer.from(projectYaml).toString("base64") };
      }
      if (method === "GET" && path.includes("/check-runs")) {
        return {
          check_runs: [
            {
              name: "check",
              status: state.ci === "pending" ? "in_progress" : "completed",
              conclusion: state.ci === "pending" ? null : state.ci,
            },
          ],
        };
      }
      throw new Error(`unhandled ${method} ${path}`);
    },
  };
  return {
    client,
    pulls: state.pulls,
    get comments() { return state.comments; },
    get clock() { return state.clock; },
    set clock(value) { state.clock = value; },
    get ci() { return state.ci; },
    set ci(value) { state.ci = value; },
  };
}
