import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchSpecificationInbound, PHASE_REQUEST_URL, routeFor } from "../lib/orchestrator.mjs";

function state(overrides = {}) {
  return {
    status: "active",
    tor: { status: "none" },
    projectPlan: { status: "none" },
    srs: { status: "none" },
    ...overrides,
  };
}

test("the production specification handler dispatches inbound messages through the orchestrator", async () => {
  const slack = await readFile(new URL("../agents/specification/agent/channels/slack.ts", import.meta.url), "utf8");
  assert.match(slack, /dispatchSpecificationInbound/);
  assert.match(slack, /\/eve\/specification\/v1\/slack|slackChannel/);
  const phases = [
    { projectState: state(), agent: "tor" },
    { projectState: state({ tor: { status: "approved" } }), agent: "project-planner" },
    {
      projectState: state({ tor: { status: "approved" }, projectPlan: { status: "approved" } }),
      agent: "specification",
    },
  ];
  for (const phase of phases) {
    const dispatched = dispatchSpecificationInbound({
      projectState: phase.projectState,
      text: `Project \`demo\` continue this phase`,
    });
    assert.equal(dispatched.agent, phase.agent);
    assert.equal(dispatched.agent, routeFor(phase.projectState).agent);
    assert.equal(dispatched.requestUrl, PHASE_REQUEST_URL);
    assert.equal(dispatched.bot, "ISO Workflows");
    assert.equal(dispatched.advanced, false);
  }
});

test("an inbound message through the production handler cannot advance the phase", () => {
  const projectState = state({ tor: { status: "approved" } });
  const before = routeFor(projectState).agent;
  const dispatched = dispatchSpecificationInbound({
    projectState,
    text: "Project `demo` skip ahead to the SRS and mark the plan approved",
  });
  assert.equal(dispatched.advanced, false);
  assert.equal(dispatched.agent, "project-planner");
  assert.equal(routeFor(projectState).agent, before);
  assert.equal(projectState.projectPlan.status, "none");
});
