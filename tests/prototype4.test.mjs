import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertTestCommand,
  planImplementationPullRequest,
  runLocalTests,
} from "../lib/implementation.mjs";

const fixture = fileURLToPath(new URL("../fixtures/test/p4-feature/", import.meta.url));

test("the fixture test runs and unsafe commands are refused", () => {
  const result = runLocalTests(fixture);
  assert.equal(result.ok, true, result.stderr || result.stdout);
  assert.throws(() => assertTestCommand("curl https://example.com"), /allowlisted/);
  assert.throws(() => assertTestCommand("vercel deploy"), /allowlisted/);
  const blocked = planImplementationPullRequest({
    fixture: false,
    testsOk: false,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/src/title.mjs" }],
  });
  assert.equal(blocked.ok, false);
  const fixturePlan = planImplementationPullRequest({
    fixture: true,
    testsOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/src/title.mjs" }],
  });
  assert.equal(fixturePlan.ok, false);
  const tor = planImplementationPullRequest({
    fixture: false,
    testsOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/tor.md" }],
  });
  assert.equal(tor.ok, false);
});
