import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertNoDeployRequest,
  deployApplication,
  planRelease,
  verifyAcceptance,
} from "../lib/release.mjs";

const root = new URL("..", import.meta.url);

test("release verification never deploys, including after approval", async () => {
  const evidence = await readFile(new URL("fixtures/test/p6-release/evidence.md", root), "utf8");
  const passed = verifyAcceptance({ evidence, torUnchanged: true });
  assert.equal(passed.ok, true, passed.errors.join("\n"));
  assert.match(passed.report, /not executed/);
  assert.equal(verifyAcceptance({ evidence, torUnchanged: false }).ok, false);
  assert.equal(verifyAcceptance({ evidence: "Tests: fail\n", torUnchanged: true }).ok, false);
  assert.equal(verifyAcceptance({ evidence: `${evidence}\nDeployed: true\n`, torUnchanged: true }).ok, false);
  const fixture = planRelease({ fixture: true, verificationOk: true });
  assert.equal(fixture.ok, false);
  assert.equal(fixture.deploy, false);
  const ready = planRelease({ fixture: false, verificationOk: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.deploy, false);
  assert.deepEqual(ready.requests, []);
  for (const approved of [false, true]) {
    const result = deployApplication({ approved });
    assert.equal(result.deployed, false);
    assert.deepEqual(result.requests, []);
  }
  assert.throws(() => assertNoDeployRequest("https://api.vercel.com/v13/deployments"), /No deploy request/);
});
