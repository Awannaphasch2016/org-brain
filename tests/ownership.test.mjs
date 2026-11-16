import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HUMAN_GATE_ACTIONS } from "../lib/gate-actions.mjs";
import { planWriteAllowed } from "../lib/plan-guard.mjs";
import { torWriteAllowed } from "../lib/tor-guard.mjs";
import { assessWrite, SPECIFICATION_DOCS } from "../lib/write-policy.mjs";
import { guidelineApproverIssue } from "../scripts/knowledge.mjs";

const AGENTS = {
  TOR: "tor",
  "Project Planner": "project-planner",
  Specification: "specification",
};

test("agent ownership names every tool, stage, and a guarded path", async () => {
  const doc = await readFile(new URL("../docs/agent-ownership.md", import.meta.url), "utf8");
  assert.match(doc, /Spec Writer Agent/);
  assert.match(doc, /Coding Agent/);
  assert.match(doc, /Grokbot/);
  assert.match(doc, /Anak/);
  assert.match(doc, /not covered/);
  const stages = new Set(Object.keys(HUMAN_GATE_ACTIONS));
  for (const [heading, folder] of Object.entries(AGENTS)) {
    const section = doc.split(`## ${heading}`)[1].split(/^## /m)[0];
    const rows = section
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("Paths"));
    const tools = new Set();
    const namedStages = new Set();
    const paths = [];
    for (const row of rows) {
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      for (const tool of cells[2].split(",").map((item) => item.trim()).filter(Boolean)) tools.add(tool);
      for (const stage of cells[1].split(",").map((item) => item.trim()).filter(Boolean)) namedStages.add(stage);
      if (cells[0]) paths.push(cells[0]);
    }
    const files = (await readdir(filePath(`agents/${folder}/agent/tools`)))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.replace(/\.ts$/, ""));
    assert.deepEqual([...tools].sort(), files.sort(), heading);
    for (const stage of namedStages) assert.equal(stages.has(stage), true, stage);
    assert.ok(paths.length > 0, heading);
    for (const path of paths) {
      const sample = path.replaceAll("<id>", "demo");
      assert.equal(sampleAllowed(folder, sample), true, sample);
    }
  }
});

test("Phase 1-3 instructions and skills match the landed groups", async () => {
  const banned = [/analyze-tor/, /1\.2 References/, /require a person's approval/, /user-approval/, /approval: always/, /runs only after/, /after the merge/];
  for (const folder of Object.values(AGENTS)) {
    const base = filePath(`agents/${folder}/agent`);
    const files = [join(base, "instructions.md"), ...(await markdownFiles(join(base, "skills")))];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const pattern of banned) assert.equal(pattern.test(text), false, `${file} ${pattern}`);
      const fallback = text.match(/record_\w+_baseline/g) ?? [];
      if (fallback.length > 0) {
        assert.match(text, /only a manual fallback/, file);
        assert.equal(fallback.length, 1, file);
      }
    }
  }
  const repo = await readFile(new URL("../docs/agent-ownership.md", import.meta.url), "utf8");
  assert.equal(/spec-to-feat|spec to feat/i.test(repo), false);
});

test("a new guideline approval cannot name an agent", () => {
  assert.equal(guidelineApproverIssue("Anak Wannaphaschaiyong"), null);
  assert.equal(guidelineApproverIssue("Grokbot on Anak's explicit approval"), null);
  assert.match(guidelineApproverIssue("Coding Agent"), /agent cannot approve/);
  assert.match(guidelineApproverIssue("Spec Writer"), /agent cannot approve/);
  assert.match(guidelineApproverIssue("Grokbot"), /explicit approval/);
});

function sampleAllowed(folder, sample) {
  if (sample.endsWith("/docs/tor.md")) {
    return torWriteAllowed({
      filePath: sample,
      branch: "tor/demo/stamp",
      grant: { agent: "tor", projectId: "demo", branchPrefix: "tor/demo/" },
    }).allowed;
  }
  if (sample.endsWith("/docs/project-plan.md")) {
    return planWriteAllowed({
      filePath: sample,
      branch: "project-plan/demo/stamp",
      grant: { agent: "project-planner", projectId: "demo", branchPrefix: "project-plan/demo/" },
    }).allowed;
  }
  if (sample.endsWith("/docs/traceability.md")) {
    return assessWrite(sample, { allowedDocs: SPECIFICATION_DOCS }).allowed && folder === "specification";
  }
  return assessWrite(sample).allowed;
}

const root = fileURLToPath(new URL("..", import.meta.url));

function filePath(relative) {
  return join(root, relative);
}

async function markdownFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}
