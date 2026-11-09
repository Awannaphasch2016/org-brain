import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateChangeReview } from "../lib/change-review.mjs";
import { sha256 } from "../lib/srs-validate.mjs";
import { planStagePullRequest } from "../lib/stage-gate.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("contradictions are rejected and accepted elaborations keep requirement ids", async () => {
  const tor = await read("projects/task-tracker-lite/docs/tor.md");
  const original = await read("fixtures/test/p5-change/srs.md");
  const revised = await read("fixtures/test/p5-change/srs-revised.md");
  const base = {
    originalSrs: original,
    torText: tor,
    expectedTorSha256: sha256(tor),
  };
  const rejected = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-contradiction.md"),
    revisedSrs: original,
  });
  assert.equal(rejected.ok, true, rejected.errors.join("\n"));
  const acceptedConflict = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-accepted-contradiction.md"),
    revisedSrs: original,
  });
  assert.equal(acceptedConflict.ok, false);
  const elaborated = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-elaboration.md"),
    revisedSrs: revised,
  });
  assert.equal(elaborated.ok, true, elaborated.errors.join("\n"));
  const customer = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-elaboration.md"),
    revisedSrs: `${revised}\n\nThe product shall provide external customer access.\n`,
  });
  assert.equal(customer.ok, false);
  const dropped = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-elaboration.md"),
    revisedSrs: revised.replace(/### FR-002[\s\S]*?Source: TOR 3\.3\n/, ""),
  });
  assert.equal(dropped.ok, false);
  const fixture = planStagePullRequest({
    fixture: true,
    validationOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/srs.md" }],
    allowedDocs: ["srs.md"],
  });
  assert.equal(fixture.ok, false);
});
