import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";
import { validateArchitecture } from "../lib/architecture-validate.mjs";
import { MERGE_FORBIDDEN, assertNotMergeRequest } from "../lib/github.mjs";
import { planStagePullRequest, resolveStageInput } from "../lib/stage-gate.mjs";
import { assessWrite } from "../lib/write-policy.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("fixture architecture passes and the broken fixture fails", async () => {
  const srs = await read("fixtures/test/p2-approved-srs/srs.md");
  const valid = await read("fixtures/test/p2-approved-srs/architecture-valid.md");
  const invalid = await read("fixtures/test/p2-approved-srs/architecture-invalid.md");
  const passed = validateArchitecture({ architecture: valid, srs });
  assert.equal(passed.ok, true, passed.errors.join("\n"));
  const failed = validateArchitecture({ architecture: invalid, srs });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes("missing required section")));
  assert.ok(failed.errors.some((error) => error.includes("FR-999")));
  assert.ok(failed.errors.some((error) => error.includes("external customer")));
});

test("fixtures and missing SRS baselines cannot become project baselines", () => {
  const fixture = resolveStageInput({
    fixtureId: "p2-approved-srs",
    previousBaselineApproved: false,
  });
  assert.equal(fixture.kind, "fixture");
  assert.equal(fixture.recordBaseline, false);
  assert.equal(fixture.openPullRequest, false);
  const blocked = resolveStageInput({ previousBaselineApproved: false });
  assert.equal(blocked.denied, true);
  const ready = resolveStageInput({ previousBaselineApproved: true });
  assert.equal(ready.recordBaseline, true);
  const planned = planStagePullRequest({
    fixture: true,
    validationOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/architecture.md" }],
    allowedDocs: ["architecture.md"],
  });
  assert.equal(planned.ok, false);
  assert.match(planned.error, /fixture/i);
});

test("architecture writes stay off the TOR and the factory slot is empty", async () => {
  assert.equal(
    assessWrite("projects/task-tracker-lite/docs/architecture.md", {
      allowedDocs: ["architecture.md"],
    }).allowed,
    true,
  );
  assert.equal(assessWrite("projects/task-tracker-lite/docs/tor.md").allowed, false);
  assert.equal(assessWrite("fixtures/test/p2-approved-srs/srs.md").allowed, false);
  await assert.rejects(access(new URL("agents/factory/agent/agent.ts", root)));
  const slack = await read("agents/architecture/agent/channels/slack.ts");
  assert.equal(slack.includes("auth: null"), false);
  assert.throws(() => assertNotMergeRequest("PUT", "/repos/o/r/pulls/3/merge"), new RegExp(MERGE_FORBIDDEN));
});
