import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-source-immutability.mjs", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout.trim();
}

test("source immutability rejects a modified snapshot", async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), "sf-immutable-"));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  const snapshot = resolve(cwd, "knowledge/sources/tor-reference/2026-11-10");
  await mkdir(snapshot, { recursive: true });
  await writeFile(resolve(snapshot, "1. TOR.txt"), "original\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "snapshot"]);
  const base = git(cwd, ["rev-parse", "HEAD"]);
  await writeFile(resolve(snapshot, "1. TOR.txt"), "changed\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "rewrite snapshot"]);
  const result = spawnSync(process.execPath, [script, base], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /immutable/i);
});
