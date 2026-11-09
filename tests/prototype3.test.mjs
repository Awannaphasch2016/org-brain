import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planGithubIssueWrites, validateFeatureIssues } from "../lib/issues-validate.mjs";
import { planStagePullRequest } from "../lib/stage-gate.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("feature issues validate in dependency order and reject cycles", async () => {
  const architecture = await read("fixtures/test/p3-approved-architecture/architecture.md");
  const valid = await read("fixtures/test/p3-approved-architecture/issues-valid.md");
  const cycle = await read("fixtures/test/p3-approved-architecture/issues-cycle.md");
  const passed = validateFeatureIssues({ issuesMarkdown: valid, architecture });
  assert.equal(passed.ok, true, passed.errors.join("\n"));
  assert.deepEqual(passed.order, ["ISS-001", "ISS-002"]);
  const failed = validateFeatureIssues({ issuesMarkdown: cycle, architecture });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes("cycle")));
  const writes = planGithubIssueWrites({ fixture: true, merged: true, issues: passed.issues });
  assert.equal(writes.ok, false);
  const live = planGithubIssueWrites({ fixture: false, merged: true, issues: passed.issues });
  assert.equal(live.ok, true);
  if (live.ok) {
    assert.equal(live.requests.every((request) => request.method === "POST" && request.path === "/issues"), true);
    assert.equal(live.requests.some((request) => request.path.includes("merge")), false);
  }
  const planned = planStagePullRequest({
    fixture: true,
    validationOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/feature-issues.md" }],
    allowedDocs: ["feature-issues.md"],
  });
  assert.equal(planned.ok, false);
});
