import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  RULESET_TEMPLATES,
  projectRuleset,
  rulesetHashesMatch,
  rulesetSpecSha256,
  templateHashes,
} from "../lib/ruleset-spec.mjs";

const root = new URL("..", import.meta.url);

test("the four ruleset templates hash with the filled App id", async () => {
  const hashes = templateHashes();
  assert.deepEqual(hashes, {
    "iso-approval-records-app-only": "6ace5c12d0b1fec0bfb5058c72f7b04bae809253995e0aeedb73f0c2f447d3d6",
    "iso-approval-records-history": "6b7e115fff131a2b48872602c472fc5ebed4f21b19a3999e2f3561f5e859c429",
    "iso-approval-executions-append-only": "5d8e8bc4e92594e9b5e8a851df7cefc5007a8ac9249425c3ae873a28baf0c0f6",
    "iso-approval-requests-keep-history": "0b939a111b63534e68bbb1a5ab3e63d609f11a00db47521f521dea0f18378298",
  });
  for (const template of RULESET_TEMPLATES) {
    const text = await readFile(new URL(`docs/iso/rulesets/${template.name}.json`, root), "utf8");
    assert.deepEqual(JSON.parse(text), template);
    assert.equal(text.includes("1210556"), false);
    assert.equal(text.includes("cursor"), false);
  }
  const noisy = {
    ...RULESET_TEMPLATES[0],
    id: 42,
    source: "repository",
    current_user_can_bypass: "never",
    bypass_actors: [{ actor_id: 1, actor_type: "Integration", bypass_mode: "always", extra: true }],
    rules: [{ type: "update", parameters: {} }, { type: "creation" }, { type: "deletion" }],
  };
  assert.equal(rulesetSpecSha256(noisy), rulesetSpecSha256({
    ...RULESET_TEMPLATES[0],
    bypass_actors: [{ actor_id: 1, actor_type: "Integration", bypass_mode: "always" }],
  }));
  assert.equal(rulesetHashesMatch([{ ...RULESET_TEMPLATES[0], id: 1 }]), false);
  assert.deepEqual(Object.keys(projectRuleset(noisy)), ["name", "target", "enforcement", "conditions", "rules", "bypass_actors"]);
});

test("verify-approval refuses to run without a request", async () => {
  const child = spawn(process.execPath, [new URL("scripts/verify-approval.mjs", root).pathname], { stdio: "ignore" });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 2);
});
