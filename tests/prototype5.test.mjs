import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { changePullRequestFiles, changeReviewValidationInput, validateChangeReview } from "../lib/change-review.mjs";
import { sha256 } from "../lib/srs-validate.mjs";
import { planStagePullRequest } from "../lib/stage-gate.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("contradictions are rejected and accepted elaborations keep requirement ids", async () => {
  const tor = await read("fixtures/test/p5-new/tor.md");
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
    revisedSrs: `${revised}\nSource: OS-001\n`,
  });
  assert.ok(customer.errors.includes("revised SRS adds excluded OS-001"));
  const dropped = validateChangeReview({
    ...base,
    review: await read("fixtures/test/p5-change/feedback-elaboration.md"),
    revisedSrs: revised.replace(/### FR-002[\s\S]*?Source: IS-002\n/, ""),
  });
  assert.ok(dropped.errors.includes("revised SRS drops IS-002"));
  const fixture = planStagePullRequest({
    fixture: true,
    validationOk: true,
    projectId: "task-tracker-lite",
    files: [{ path: "projects/task-tracker-lite/docs/srs.md" }],
    allowedDocs: ["srs.md"],
  });
  assert.equal(fixture.ok, false);
});

test("an IS that survives only as an N/A-with-reason row still passes", async () => {
  const tor = await read("fixtures/test/p5-new/tor.md");
  const original = await read("fixtures/test/p5-change/srs.md");
  const revised = await read("fixtures/test/p5-change/srs-revised.md");
  const waived = [
    "| Requirement | Source IS | Status | Reason |",
    "| --- | --- | --- | --- |",
    "| FR-002 | IS-002 | N/A | Status updates are deferred. |",
  ].join("\n");
  const revisedSrs = revised.replace(/### FR-002[\s\S]*?Source: IS-002\n/, "");
  const kept = validateChangeReview({
    originalSrs: original,
    revisedSrs,
    originalTraceability: waived,
    revisedTraceability: waived,
    torText: tor,
    expectedTorSha256: sha256(tor),
    review: await read("fixtures/test/p5-change/feedback-elaboration.md"),
  });
  assert.equal(kept.ok, true, kept.errors.join("\n"));
  const input = changeReviewValidationInput({
    loaded: { srsText: original, torText: tor, torSha256: sha256(tor), traceabilityText: waived },
    review: "review",
    revisedSrs,
    revisedTraceability: waived,
  });
  assert.equal(input.originalTraceability, waived);
  assert.equal(input.revisedTraceability, waived);
  const committed = changePullRequestFiles({
    projectId: "demo",
    review: "review",
    revisedSrs,
    revisedTraceability: waived,
    report: kept.report,
  });
  assert.equal(committed.some((file) => file.path === "projects/demo/docs/traceability.md"), true);
  const omitted = changePullRequestFiles({
    projectId: "demo",
    review: "review",
    revisedSrs,
    revisedTraceability: null,
    report: kept.report,
  });
  assert.equal(omitted.some((file) => file.path.endsWith("traceability.md")), false);
});
