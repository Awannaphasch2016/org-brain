import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { torContractFields, validateIntake, torSectionsFromGuideline } from "../lib/intake-validate.mjs";
import { pendingGuidelineFiles, guidelineFiles } from "../scripts/knowledge.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("all missing fields reported in one result", async () => {
  const result = await validateFixture("p1-intake-empty");
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 5);
  assert.ok(result.errors.some((error) => error.includes("1.1")));
  assert.ok(result.errors.some((error) => error.includes("5.3")));
  assert.ok(result.errors.some((error) => error.includes("IS-nnn")));
  assert.ok(result.errors.some((error) => error.includes("OS-nnn")));
  assert.ok(result.errors.some((error) => error.includes("TEL ids")));
  const contract = torContractFields(await read("knowledge/guidelines/tor-contract-fields.md"));
  for (const field of contract.required) {
    assert.ok(
      result.errors.some((error) => error === `missing required intake field: ${field.name}`),
      field.name,
    );
  }
});

test("each missing intake field is reported by name", async () => {
  const contract = torContractFields(await read("knowledge/guidelines/tor-contract-fields.md"));
  const tor = await read("fixtures/test/p1-intake-complete/tor.md");
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const analysis = await read("fixtures/test/p1-intake-complete/tor-analysis.md");
  const elicitationLog = await read("fixtures/test/p1-intake-complete/tor-elicitation-log.md");
  for (const field of contract.required) {
    const stripped = tor.replace(new RegExp(`^${field.label}:.*$`, "m"), "");
    const result = validateIntake({ tor: stripped, analysis, elicitationLog, structureMarkdown: structure });
    assert.ok(
      result.errors.some((error) => error === `missing required intake field: ${field.name}`),
      field.name,
    );
    for (const other of contract.required) {
      if (other.name === field.name) continue;
      assert.equal(
        result.errors.some((error) => error === `missing required intake field: ${other.name}`),
        false,
        `${field.name} also dropped ${other.name}`,
      );
    }
  }
});

test("all missing intake fields are reported at once", async () => {
  const contract = torContractFields(await read("knowledge/guidelines/tor-contract-fields.md"));
  const result = await validateFixture("p1-intake-empty");
  assert.deepEqual(
    result.errors.filter((error) => error.startsWith("missing required intake field:")),
    contract.required.map((field) => `missing required intake field: ${field.name}`),
  );
});

test("target dates are optional", async () => {
  const result = await validateFixture("p1-intake-complete");
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.errors.some((error) => /target dates/i.test(error)), false);
  const withDates = validateIntake({
    tor: `${await read("fixtures/test/p1-intake-complete/tor.md")}\nTarget dates: 2026-12-01\n`,
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    elicitationLog: await read("fixtures/test/p1-intake-complete/tor-elicitation-log.md"),
    structureMarkdown: await read("knowledge/guidelines/tor-structure.md"),
  });
  assert.equal(withDates.ok, true, withDates.errors.join("\n"));
});

test("IS/OS required and unique; none-identified rejected", async () => {
  const result = await validateFixture("p1-intake-partial");
  assert.ok(result.errors.some((error) => error.includes("duplicate IS id: IS-001")));
  assert.ok(result.errors.some((error) => error.includes("none identified")));
  assert.ok(result.errors.some((error) => error.includes("OS-nnn")));
});

test("blocking unresolved gap fails; nonblocking passes", async () => {
  const blocking = await validateFixture("p1-intake-partial");
  assert.ok(blocking.errors.some((error) => error.includes("blocking unresolved gap: G-001")));
  const complete = await validateFixture("p1-intake-complete");
  assert.equal(complete.errors.some((error) => error.includes("blocking unresolved")), false);
  assert.equal(complete.ok, true, complete.errors.join("\n"));
});

test("unconfirmed required field fails", async () => {
  const result = await validateFixture("p1-intake-partial");
  assert.ok(result.errors.some((error) => error.includes("unconfirmed required field: 1.1")));
});

test("TEL ids required; EL ids rejected in tor log", async () => {
  const result = await validateFixture("p1-intake-partial");
  assert.ok(result.errors.some((error) => error.includes("EL ids are not valid")));
  assert.ok(result.errors.some((error) => error.includes("TEL ids are required")));
  const complete = await validateFixture("p1-intake-complete");
  assert.equal(complete.errors.some((error) => /EL ids/.test(error)), false);
});

test("conflict must be rejected/escalated", async () => {
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const open = validateIntake({
    tor: await read("fixtures/test/p1-intake-complete/tor.md"),
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    elicitationLog: "## TEL-003\n\nclass: conflict\nresolution: open\n",
    structureMarkdown: structure,
  });
  assert.ok(open.errors.some((error) => error.includes("TEL-003 conflict must be rejected or escalated")));
  const escalated = validateIntake({
    tor: await read("fixtures/test/p1-intake-complete/tor.md"),
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    elicitationLog: "## TEL-003\n\nclass: conflict\nresolution: escalated\n",
    structureMarkdown: structure,
  });
  assert.equal(escalated.ok, true, escalated.errors.join("\n"));
});

test("dates optional", async () => {
  const result = await validateFixture("p1-intake-complete");
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.errors.some((error) => /date/i.test(error)), false);
  const tor = await read("fixtures/test/p1-intake-complete/tor.md");
  assert.match(tor, /No target date is set/);
});

test("contract test: enforced sections match tor-structure.md", async () => {
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const parsed = torSectionsFromGuideline(structure);
  const fromFile = [...structure.matchAll(/\b(\d+\.\d+)\s+[A-Za-z]/g)].map((match) => match[1]);
  assert.deepEqual(parsed.required.map((section) => section.id), fromFile);
  assert.deepEqual(parsed.optional.map((section) => section.title), ["References"]);
  const result = await validateFixture("p1-intake-empty");
  assert.deepEqual(
    result.enforcedSections,
    parsed.required.map((section) => `${section.id} ${section.title}`),
  );
});

test("tor-drafting.md needs approval and is not an approved guideline", async () => {
  const pending = await pendingGuidelineFiles();
  const approved = await guidelineFiles();
  assert.ok(pending.some((path) => path.endsWith("tor-drafting.md")));
  assert.equal(approved.some((path) => path.endsWith("tor-drafting.md")), false);
  const text = await read("knowledge/guidelines/tor-drafting.md");
  assert.match(text, /approval:\s*required/);
  assert.match(text, /IS-nnn/);
  assert.match(text, /TEL-nnn/);
});

async function validateFixture(id) {
  return validateIntake({
    tor: await read(`fixtures/test/${id}/tor.md`),
    analysis: await read(`fixtures/test/${id}/tor-analysis.md`),
    elicitationLog: await read(`fixtures/test/${id}/tor-elicitation-log.md`),
    structureMarkdown: await read("knowledge/guidelines/tor-structure.md"),
  });
}
