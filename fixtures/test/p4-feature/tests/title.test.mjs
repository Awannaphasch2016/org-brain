import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTitle } from "../src/title.mjs";

test("keeps a non-empty title", () => {
  assert.equal(normalizeTitle("  Pay invoice  "), "Pay invoice");
});

test("rejects a blank title", () => {
  assert.throws(() => normalizeTitle("  "), /title is required/);
});
