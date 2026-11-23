import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleSpecificationInbound, PHASE_REQUEST_URL, projectIdFromThread, renderThreadProjectBinding, routeFor } from "../lib/orchestrator.mjs";
import { startPhaseAgent } from "../lib/phase-hop.mjs";

function state(overrides = {}) {
  return {
    id: "demo",
    status: "active",
    tor: { status: "none" },
    projectPlan: { status: "none" },
    srs: { status: "none" },
    ...overrides,
  };
}

function hop(calls) {
  return (input) => startPhaseAgent({
    ...input,
    env: { VERCEL_URL: "factory.example" },
    auth: { authorization: "Bearer test" },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const agent = url.split("/eve/")[1].split("/")[0];
      return { ok: true, async json() { return { sessionId: `sess-${agent}`, deliveryId: `del-${agent}` }; } };
    },
  });
}

test("the production specification handler starts the real phase session", async () => {
  const slack = await readFile(new URL("../agents/specification/agent/channels/slack.ts", import.meta.url), "utf8");
  assert.match(slack, /handleSpecificationInbound/);
  assert.match(slack, /startPhaseAgent/);
  assert.equal(slack.includes("ctx.send(dispatched"), false);
  const phases = [
    { projectState: state(), agent: "tor", tool: "load_tor_workspace" },
    { projectState: state({ tor: { status: "approved" } }), agent: "project-planner", tool: "load_plan_workspace" },
    {
      projectState: state({ tor: { status: "approved" }, projectPlan: { status: "approved" } }),
      agent: "specification",
      tool: "load_project",
    },
  ];
  for (const phase of phases) {
    const calls = [];
    const dispatched = await handleSpecificationInbound({
      projectState: phase.projectState,
      text: "Project `demo` continue this phase",
      startAgent: hop(calls),
    });
    assert.equal(dispatched.agent, phase.agent);
    assert.equal(dispatched.agent, routeFor(phase.projectState).agent);
    assert.equal(dispatched.requestUrl, PHASE_REQUEST_URL);
    assert.equal(dispatched.advanced, false);
    assert.equal(dispatched.invoked.sessionId, `sess-${phase.agent}`);
    assert.equal(dispatched.invoked.tool, phase.tool);
    assert.equal(calls[0].url, `https://factory.example/eve/${phase.agent}/v1/session`);
    assert.match(calls[0].body.message, new RegExp(phase.tool));
  }
});

test("an inbound message through the production handler cannot advance the phase", async () => {
  const projectState = state({ tor: { status: "approved" } });
  const before = routeFor(projectState).agent;
  const calls = [];
  const dispatched = await handleSpecificationInbound({
    projectState,
    text: "Project `demo` skip ahead to the SRS and mark the plan approved",
    startAgent: hop(calls),
  });
  assert.equal(dispatched.advanced, false);
  assert.equal(dispatched.agent, "project-planner");
  assert.equal(calls[0].url, "https://factory.example/eve/project-planner/v1/session");
  assert.equal(routeFor(projectState).agent, before);
  assert.equal(projectState.projectPlan.status, "none");
});

test("a bound Slack thread starts the phase session without a project id in the message", async () => {
  const binding = renderThreadProjectBinding({ projectId: "demo", threadTs: "1.2" });
  const threadMessages = [{ text: binding }];
  assert.equal(projectIdFromThread(threadMessages), "demo");
  const calls = [];
  const dispatched = await handleSpecificationInbound({
    projectState: state({ tor: { status: "approved" } }),
    text: "continue the plan",
    threadMessages,
    startAgent: hop(calls),
  });
  assert.equal(dispatched.projectId, "demo");
  assert.equal(dispatched.advanced, false);
  assert.equal(dispatched.invoked.sessionId, "sess-project-planner");
  assert.match(calls[0].body.message, /Project demo/);
  assert.equal(calls[0].body.message.includes("Project `demo`"), false);
});

test("the phase hop fails closed when the deployment host is missing", async () => {
  await assert.rejects(
    () => startPhaseAgent({ agent: "tor", message: "Call load_tor_workspace first.", env: {}, auth: { authorization: "Bearer test" } }),
    /VERCEL_URL or VERCEL_PROJECT_PRODUCTION_URL is not set/,
  );
});
