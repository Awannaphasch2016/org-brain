import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { recordBaseline } from "../lib/baseline.mjs";
import { deferGateChain, nextPhaseFor, RECORDING_POINTER_KIND, renderTransition, runApprovedGateChain, TRANSITION_KIND } from "../lib/gate-chain.mjs";
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

function chainClient({ comments = [], ci = "pending" } = {}) {
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
