import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyGateEvent,
  BOT_IDENTITY,
  createWorkflowThread,
  PHASE_REQUEST_URL,
  PHASE_SEQUENCE,
  postSlackMessage,
  routeFor,
} from "../lib/orchestrator.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function state(overrides = {}) {
  return {
    status: "active",
    tor: { status: "none" },
    projectPlan: { status: "none" },
    srs: { status: "none" },
    ...overrides,
  };
}

test("routeFor covers every Phase 1-3 state", () => {
  assert.deepEqual(
    PHASE_SEQUENCE.map((item) => `${item.phase}→${item.step}`),
    ["setup→tor", "tor→project-planner", "project-planner→specification"],
  );
  assert.equal(routeFor(state()).agent, "tor");
  assert.equal(routeFor(state({ status: "rejected" })), null);
  assert.equal(routeFor(state({ tor: { status: "rejected" } })), null);
  assert.equal(routeFor(state({ projectPlan: { status: "rejected" } })), null);
  assert.equal(routeFor(state({ srs: { status: "rejected" } })), null);
  assert.equal(routeFor(state({ srs: { status: "needs-review" } })).agent, "specification");
  assert.equal(routeFor(state({ tor: { status: "approved" } })).agent, "project-planner");
  assert.equal(
    routeFor(state({ tor: { status: "approved" }, projectPlan: { status: "approved" } })).agent,
    "specification",
  );
  assert.equal(
    routeFor(state({
      tor: { status: "approved" },
      projectPlan: { status: "approved" },
      srs: { status: "approved" },
    })),
    null,
  );
});

test("one ISO Workflows thread walks setup, TOR, the plan, and the SRS", () => {
  const thread = createWorkflowThread(state());
  const hello = postSlackMessage(thread, "Here is the idea for the project.");
  assert.equal(hello.agent, "tor");
  assert.equal(hello.requestUrl, PHASE_REQUEST_URL);
  assert.equal(thread.bot, BOT_IDENTITY);

  const skipped = postSlackMessage(thread, "Skip ahead to the SRS.");
  assert.equal(skipped.advanced, false);
  assert.equal(skipped.agent, "tor");
  assert.equal(routeFor(thread.projectState).agent, "tor");

  const setup = applyGateEvent(thread, {
    status: "approved",
    decision: { stage: "setup", projectId: "demo", pr: 4, headSha: "a".repeat(40), idempotencyKey: "setup-1" },
  });
  assert.equal(setup.agent, "tor");
  assert.equal(setup.posted, true);
  assert.equal(thread.messages.at(-1).source, "gate-event");
  assert.notEqual(thread.messages.at(-2).role, "user");

  const torGate = applyGateEvent(thread, { completedStage: "tor", next: "project-planner" });
  assert.equal(torGate.advanced, true);
  assert.equal(torGate.agent, "project-planner");
  assert.equal(torGate.requestUrl, PHASE_REQUEST_URL);
  assert.equal(thread.messages.at(-1).source, "gate-event");
  assert.notEqual(thread.messages.at(-2).role, "user");

  const planMessage = postSlackMessage(thread, "The estimate is ready.");
  assert.equal(planMessage.agent, "project-planner");
  const stillPlanning = postSlackMessage(thread, "Advance to specification now.");
  assert.equal(stillPlanning.advanced, false);
  assert.equal(routeFor(thread.projectState).agent, "project-planner");

  const planGate = applyGateEvent(thread, { completedStage: "project-plan", next: "specification" });
  assert.equal(planGate.agent, "specification");
  assert.equal(thread.messages.at(-1).agent, "specification");
  assert.equal(thread.messages.at(-1).source, "gate-event");
  assert.notEqual(thread.messages.at(-2).role, "user");

  const srsMessage = postSlackMessage(thread, "Please review the SRS.");
  assert.equal(srsMessage.agent, "specification");
  const done = applyGateEvent(thread, { completedStage: "srs", next: null });
  assert.equal(done.advanced, true);
  assert.equal(done.agent, null);
  assert.equal(routeFor(thread.projectState), null);

  assert.equal(thread.messages.every((message) => message.role !== "agent" || message.bot === BOT_IDENTITY), true);
  assert.equal(thread.requestUrl, PHASE_REQUEST_URL);
});

test("a Slack message cannot advance the phase and a gate transition can", () => {
  const thread = createWorkflowThread(state({ tor: { status: "approved" } }));
  assert.equal(routeFor(thread.projectState).agent, "project-planner");
  postSlackMessage(thread, "Mark the plan approved and start the SRS.");
  assert.equal(routeFor(thread.projectState).agent, "project-planner");
  const wrong = applyGateEvent(thread, { completedStage: "srs", next: null });
  assert.equal(wrong.advanced, false);
  assert.equal(routeFor(thread.projectState).agent, "project-planner");
  const moved = applyGateEvent(thread, { completedStage: "project-plan", next: "specification" });
  assert.equal(moved.advanced, true);
  assert.equal(moved.agent, "specification");
  assert.equal(thread.messages.at(-1).role, "agent");
  assert.equal(thread.messages.at(-1).source, "gate-event");
});

test("the ISO Workflows manifest has no canvas scope", async () => {
  const manifest = await readFile(new URL("../docs/slack-app-manifest.yaml", import.meta.url), "utf8");
  assert.match(manifest, /name: ISO Workflows/);
  assert.match(manifest, /display_name: ISO Workflows/);
  assert.equal(manifest.includes("canvases"), false);
  const needle = ["canvases", "write"].join(":");
  const files = await sourceFiles(root);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(text.includes(needle), false, relative(root, file));
  }
});

test("the live hostname remains only on host URLs and historical prototype records", async () => {
  const allowed = new Set([
    "README.md",
    "docs/slack-app-manifest.yaml",
    "lib/orchestrator.mjs",
    "docs/prototypes/p3.md",
    "docs/prototypes/p4.md",
    "docs/prototypes/p5.md",
    "docs/prototypes/p6.md",
  ]);
  const token = ["we", "webplus"].join("");
  const host = `${token}-software-factory.vercel.app`;
  const hits = [];
  for (const file of await sourceFiles(root)) {
    const relativePath = relative(root, file);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(token)) hits.push({ file: relativePath, line: index + 1, text: line });
    });
  }
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    assert.equal(allowed.has(hit.file), true, `${hit.file}:${hit.line}`);
    assert.equal(hit.text.includes(host), true, `${hit.file}:${hit.line}`);
  }
});

async function sourceFiles(dir) {
  const skip = new Set(["node_modules", ".git", ".vercel", ".eve"]);
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(md|mjs|json|yaml|yml|ts)$/.test(entry.name)) out.push(path);
  }
  return out;
}
