import assert from "node:assert/strict";
import test from "node:test";
import { assertFailClosedAllowlists, fail } from "./knowledge.mjs";

test("an approved empty allowlist is rejected", () => {
  assert.throws(
    () => assertFailClosedAllowlists({ allowedChannelIds: [], allowedUserIds: ["U0CFRUV378D"] }),
    /allowedChannelIds/,
  );
  assert.throws(
    () => assertFailClosedAllowlists({ allowedChannelIds: ["C0CG6SG8PNW"], allowedUserIds: [] }),
    /allowedUserIds/,
  );
  assert.throws(() => fail("example"), /example/);
});
