import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertCommitLeavesTorUntouched, GithubClient, openReviewedPullRequest } from "../lib/github.mjs";
import { planStagePullRequest } from "../lib/stage-gate.mjs";
import { issueTorWriteGrant, torWriteAllowed } from "../lib/tor-guard.mjs";
import { assessWrite } from "../lib/write-policy.mjs";

const grant = { agent: "tor", projectId: "demo", branchPrefix: "tor/demo/" };
const other = { agent: "tor", projectId: "other", branchPrefix: "tor/other/" };
const path = "projects/demo/docs/tor.md";

test("TOR write guard matrix", () => {
  const cases = [
    { name: "matching grant", grant, branch: "tor/demo/20261114T100000Z", allowed: true },
    { name: "without grant", grant: null, branch: "tor/demo/20261114T100000Z", allowed: false },
    { name: "another project", grant: other, branch: "tor/other/20261114T100000Z", allowed: false },
    { name: "non-tor branch", grant, branch: "spec/demo/srs/stamp", allowed: false },
  ];
  for (const item of cases) {
    const write = assessWrite(path, { torGrant: item.grant, branch: item.branch });
    assert.equal(write.allowed, item.allowed, `write-policy ${item.name}`);
    const stage = planStagePullRequest({
      fixture: false,
      validationOk: true,
      projectId: "demo",
      branch: item.branch,
      torGrant: item.grant,
      files: [{ path }],
      allowedDocs: ["tor.md"],
    });
    assert.equal(stage.ok, item.allowed, `stage-gate ${item.name}`);
    const reviewed = torWriteAllowed({ filePath: path, branch: item.branch, grant: item.grant });
    assert.equal(reviewed.allowed, item.allowed, `open-reviewed ${item.name}`);
    if (item.allowed) {
      assert.doesNotThrow(() => assertCommitLeavesTorUntouched([{ path }], { torGrant: item.grant, branch: item.branch }));
    } else {
      assert.throws(
        () => assertCommitLeavesTorUntouched([{ path }], { torGrant: item.grant, branch: item.branch }),
        /TOR/,
        `commit ${item.name}`,
      );
    }
  }
});

test("grant refused when docs/tor.md exists on main", async () => {
  const client = grantClient({ yaml: activeYaml("none"), tor: "# existing\n" });
  const issued = await issueTorWriteGrant(client, "demo");
  assert.equal(issued.ok, false);
  assert.match(issued.reason, /already exists/);
});

test("grant refused when tor.status approved or project rejected", async () => {
  const approved = await issueTorWriteGrant(grantClient({ yaml: activeYaml("approved"), tor: null }), "demo");
  assert.equal(approved.ok, false);
  assert.match(approved.reason, /not open/);
  const rejected = await issueTorWriteGrant(
    grantClient({ yaml: activeYaml("none").replace("status: active", "status: rejected"), tor: null }),
    "demo",
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /rejected/);
});

test("only agents/tor imports issueTorWriteGrant", async () => {
  const root = resolve(new URL("..", import.meta.url).pathname, "agents");
  const files = await sourceFiles(root);
  const importers = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (text.includes("issueTorWriteGrant")) importers.push(file);
  }
  assert.ok(importers.length > 0);
  assert.ok(importers.every((file) => file.includes(`${resolve(root, "tor")}/`)));
});

test("every other agent's write path still refuses tor.md", async () => {
  const root = resolve(new URL("..", import.meta.url).pathname, "agents");
  const names = (await readdir(root)).filter((name) => name !== "tor");
  assert.ok(names.length >= 6);
  for (const name of names) {
    const writer = resolve(root, name, "agent/tools/write_file.ts");
    const text = await readFile(writer, "utf8");
    assert.equal(text.includes("issueTorWriteGrant"), false, name);
    assert.equal(assessWrite(`projects/demo/docs/tor.md`).allowed, false, name);
  }
});

function activeYaml(torStatus) {
  return `id: demo
title: Demo
status: active
tor:
  path: docs/tor.md
  status: ${torStatus}
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
authorization:
  allowedSlackUserIds:
    - U0CFRUV378D
`;
}

function grantClient({ yaml, tor }) {
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    if (method === "GET" && pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const text = filePath.endsWith("project.yaml") ? yaml : tor;
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64") });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

function http(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("openReviewedPullRequest refuses a TOR write before any fetch when the grant does not match", async () => {
  let fetched = false;
  const client = {
    owner: "o",
    repo: "r",
    async request() {
      fetched = true;
      throw new Error("fetched");
    },
  };
  await assert.rejects(
    () =>
      openReviewedPullRequest(client, {
        projectId: "demo",
        baseBranch: "main",
        branch: "tor/demo/stamp",
        title: "TOR",
        body: "no",
        files: [{ path, content: "# TOR\n" }],
      }),
    /frozen TOR|TOR writes/,
  );
  assert.equal(fetched, false);
});
