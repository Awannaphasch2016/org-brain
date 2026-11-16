import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { sha256, validateSrs } from "../lib/srs-validate.mjs";

const tor = "IS-001 keep\nIS-002 later\n";
const srs = `# Introduction

Intro

# Scope

Scope

# Functional Requirements

### FR-001

Keep it.

Source: IS-001

# Nonfunctional Requirements

### NFR-001

Stay small.

Source: IS-001

# Acceptance Criteria

### AC-001

Readable.

Verifies: FR-001

# Constraints and References

None.
`;

function table(rows) {
  return ["| Requirement | Source IS | Status | Reason |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

const covered = table([
  "| FR-001 | IS-001 | covered | keep |",
  "| NFR-001 | IS-001 | covered | keep |",
  "| IS-002 | IS-002 | N/A | later release |",
]);

function run(traceability, srsText = srs) {
  return validateSrs({
    srs: srsText,
    torText: tor,
    expectedTorSha256: sha256(tor),
    traceability,
    analysis: "## Gap register\n\n- G-001 | nonblocking | resolved | none\n",
  });
}

test("traceability file missing fails", () => {
  const result = run("");
  assert.ok(result.errors.includes("docs/traceability.md is missing"));
});

test("a traceability row that disagrees with the SRS fails", () => {
  const unknown = run(table(["| FR-009 | IS-001 | covered | no |", "| NFR-001 | IS-001 | covered | keep |", "| IS-002 | IS-002 | N/A | later |"]));
  assert.ok(unknown.errors.includes("row FR-009 disagrees with srs.md"));
  const different = run(table(["| FR-001 | IS-002 | covered | wrong |", "| NFR-001 | IS-001 | covered | keep |", "| IS-002 | IS-002 | N/A | later |"]));
  assert.ok(different.errors.includes("row FR-001 disagrees with srs.md"));
});

test("an uncovered IS and an N/A without a reason fail", () => {
  const uncovered = run(table(["| FR-001 | IS-001 | covered | keep |", "| NFR-001 | IS-001 | covered | keep |"]));
  assert.ok(uncovered.errors.includes("IS-002 is neither covered nor N/A"));
  const emptyReason = run(table(["| FR-001 | IS-001 | covered | keep |", "| NFR-001 | IS-001 | covered | keep |", "| IS-002 | IS-002 | N/A |  |"]));
  assert.ok(emptyReason.errors.includes("IS-002 N/A has no reason"));
});

test("a complete traceability table passes and a Traceability heading in the SRS fails", () => {
  const pass = run(covered);
  assert.equal(pass.ok, true, pass.errors.join("\n"));
  assert.match(pass.report.split("\n")[0], /^# WP-SR-RS-01-VV\b/);
  const headed = run(covered, `${srs}\n# Traceability\n\n| a | b |\n`);
  assert.ok(headed.errors.includes("traceability belongs in docs/traceability.md"));
});

test("the mapping skill replaces analyze-tor and the guideline states the row format", async () => {
  const root = new URL("../agents/specification/", import.meta.url);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  for (const file of files) {
    if (!String(file.pathname).endsWith(".md")) continue;
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("analyze-tor"), false, file.pathname);
  }
  const instructions = await readFile(new URL("../agents/specification/agent/instructions.md", import.meta.url), "utf8");
  assert.match(instructions, /map-tor-analysis/);
  const guideline = await readFile(new URL("../knowledge/guidelines/traceability.md", import.meta.url), "utf8");
  const links = guideline.split("## Required links")[1].split("## Statement shape")[0];
  assert.equal(/TOR clause|EL-001/.test(links), false);
  assert.match(guideline, /Source: IS-001/);
  assert.match(guideline, /\| Requirement \| Source IS \| Status \| Reason \|/);
});
