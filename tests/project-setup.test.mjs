import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDecision, renderDecisionComment } from "../lib/gate-decision.mjs";
import { GithubClient, openReviewedPullRequest } from "../lib/github.mjs";
import { parseSimpleYaml } from "../lib/project-yaml.mjs";
import {
  assessTorUpload,
  closeSetupProject,
  createProjectSetup,
  loadSlackUpload,
  openRejectedStatusPullRequest,
  renderStarterProjectYaml,
  resolveSlackAttachmentPath,
  starterYamlAcceptsWrites,
} from "../lib/project-setup.mjs";
import { assessWrite } from "../lib/write-policy.mjs";
import { IDENTITY, pullFixture } from "./gate-harness.mjs";

const ANAK = "U0CFRUV378D";
const SECRET = "test-signing-secret";
const STAMP = "20261114T090000Z";
const HEAD = "a".repeat(40);
const UPLOADER = `slack:T0TEAM:${ANAK}`;

test("duplicate id refused (main dir and open branch)", async () => {
  const onMain = setupClient({ directory: true });
  await assert.rejects(
    () => createProjectSetup(onMain.client, setupInput()),
    /default branch/,
  );
  const openBranch = setupClient({ refs: [{ ref: "refs/heads/setup/demo/old" }] });
  await assert.rejects(
    () => createProjectSetup(openBranch.client, setupInput()),
    /open branch/,
  );
});

test("binary/oversize/wrong-type file refused", () => {
  assert.equal(assessTorUpload({ filename: "tor.pdf", mediaType: "application/pdf", bytes: Buffer.from("hello") }).reason, "wrong file type");
  assert.equal(
    assessTorUpload({ filename: "tor.md", mediaType: "text/plain", bytes: Buffer.from("# TOR\n") }).reason,
    "wrong file type",
  );
  assert.equal(
    assessTorUpload({ filename: "tor.md", mediaType: "text/markdown", bytes: Buffer.concat([Buffer.from("# TOR"), Buffer.from([0])]) }).reason,
    "binary file",
  );
  assert.equal(
    assessTorUpload({ filename: "tor.md", mediaType: "text/markdown", bytes: Buffer.alloc(1_000_001, 0x61) }).reason,
    "file is larger than 1 MB",
  );
  assert.equal(assessTorUpload({ filename: "tor.txt", mediaType: "text/plain", bytes: Buffer.from("plain\n") }).ok, true);
});

test("starter yaml parses and contains every key setYamlPath needs", () => {
  const yaml = renderStarterProjectYaml({
    id: "demo",
    title: "Demo",
    uploader: UPLOADER,
    uploadedAt: "2026-11-14T09:00:00.000Z",
    slackFileId: "F123",
    sourceSha256: "ab".repeat(32),
    mediaType: "text/markdown",
  });
  const parsed = parseSimpleYaml(yaml);
  assert.equal(parsed.status, "active");
  assert.equal(parsed.tor.status, "none");
  assert.equal(parsed.authorization.allowedSlackUserIds[0], ANAK);
  assert.equal(parsed.intake.source.path, "intake/tor-source.md");
  const written = starterYamlAcceptsWrites(yaml);
  assert.equal(written.tor.baseline.sha256, "value");
  assert.equal(written.srs.baseline.sourceTorCommit, "value");
  assert.equal(written.architecture.baseline.sourceSrsCommit, "value");
  assert.equal(written.intake.setupPullRequest, 1);
});

test("setup reads Slack attachment bytes and refuses a path outside the attachment store", () => {
  const bytes = Buffer.from("# TOR\n\nIn scope.\n");
  const loaded = loadSlackUpload({
    attachmentPath: "/workspace/.eve/attachments/abc123/tor.md",
    bytes,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.slackFileId, "attachment:abc123");
  assert.equal(loaded.mediaType, "text/markdown");
  assert.equal(loaded.text, bytes.toString("utf8"));
  assert.equal(resolveSlackAttachmentPath("/workspace/.eve/attachments/abc123/../../etc/passwd").ok, false);
  assert.equal(resolveSlackAttachmentPath("projects/demo/docs/tor.md").ok, false);
  assert.equal(resolveSlackAttachmentPath("/workspace/.eve/attachments/abc123/tor.pdf").ok, true);
  assert.equal(
    loadSlackUpload({ attachmentPath: "/workspace/.eve/attachments/abc123/tor.pdf", bytes }).reason,
    "wrong file type",
  );
  const source = readFileSync(new URL("../agents/tor/agent/tools/create_project.ts", import.meta.url), "utf8");
  assert.equal(source.includes("contentBase64"), false);
  assert.match(source, /readBinaryFile/);
  assert.match(source, /loadSlackUpload/);
});

test("uploader not in allowlist refused", async () => {
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
    () => createProjectSetup(client, setupInput({ userId: "UOTHER" })),
    /allowlist/,
  );
  assert.equal(fetched, false);
});

test("setup PR contains exactly two paths", async () => {
  const harness = setupClient();
  const opened = await createProjectSetup(harness.client, setupInput());
  assert.equal(opened.branch, `setup/demo/${STAMP}`);
  assert.equal(opened.merged, false);
  const tree = harness.state.trees[0].tree.map((entry) => entry.path).sort();
  assert.deepEqual(tree, [
    "projects/demo/intake/tor-source.md",
    "projects/demo/project.yaml",
  ]);
  const actions = opened.card.blocks.find((block) => block.type === "actions").elements.map((element) => element.action_id);
  assert.deepEqual(actions, ["gate:approve", "gate:reject"]);
  await closeSetupProject(harness.client, { projectId: "demo", pullNumber: opened.number });
  assert.equal(harness.state.merges.length, 0);
  assert.equal(harness.state.closes, 1);
});

test("intake source is immutable after setup", async () => {
  assert.equal(assessWrite("projects/demo/intake/tor-source.md").allowed, false);
  const harness = setupClient({ files: { "projects/demo/intake/tor-source.md": "sha-intake" } });
  const client = new GithubClient({
    fetchImpl: harness.fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
  });
  await assert.rejects(
    () =>
      openReviewedPullRequest(client, {
        projectId: "demo",
        baseBranch: "main",
        branch: "spec/demo/srs/stamp",
        title: "edit source",
        body: "no",
        files: [{ path: "projects/demo/intake/tor-source.md", content: "changed\n" }],
      }),
    /immutable after setup/,
  );
});

test("reject marks status: rejected via gate only", async () => {
  const yaml = "id: demo\ntitle: Demo\nstatus: active\n";
  const missing = rejectClient({ yaml, comments: [] });
  await assert.rejects(
    () => openRejectedStatusPullRequest(missing.client, rejectInput()),
    /gate reject decision/,
  );
  assert.equal(missing.state.merges.length, 0);
  const approved = rejectClient({ yaml, action: "approve" });
  await assert.rejects(
    () => openRejectedStatusPullRequest(approved.client, rejectInput()),
    /gate reject decision/,
  );
  const rejected = rejectClient({ yaml, action: "reject" });
  const opened = await openRejectedStatusPullRequest(rejected.client, rejectInput({ approvedBy: "attacker" }));
  assert.equal(parseSimpleYaml(opened.projectYaml).status, "rejected");
  assert.equal(opened.projectYaml.includes("attacker"), false);
  assert.equal(opened.merged, false);
  assert.equal(rejected.state.merges.length, 0);
  assert.equal(rejected.state.trees[0].tree.length, 1);
  assert.equal(rejected.state.trees[0].tree[0].path, "projects/demo/project.yaml");
});

function setupInput(overrides = {}) {
  return {
    projectId: "demo",
    title: "Demo",
    filename: "tor.md",
    mediaType: "text/markdown",
    bytes: Buffer.from("# TOR\n\nIn scope.\n"),
    slackFileId: "F123",
    uploadedBy: UPLOADER,
    uploadedAt: "2026-11-14T09:00:00.000Z",
    userId: ANAK,
    allowedUserIds: [ANAK],
    stamp: STAMP,
    ...overrides,
  };
}

function rejectInput(overrides = {}) {
  return {
    projectId: "demo",
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    ...overrides,
  };
}

function decisionComment(action) {
  const decision = buildDecision({
    projectId: "demo",
    stage: "setup",
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: "c".repeat(40),
    action,
    decidedBy: UPLOADER,
    decidedAt: "2026-11-14T09:00:00.000Z",
    slack: {
      channel: "C0CG6SG8PNW",
      ts: "1700000000.000100",
      permalink: null,
      verification: "hmac",
      requestTimestamp: "1700000000",
    },
    reason: action === "approve" ? null : "out of scope",
    humanCommits: [],
    idempotencyKey: `setup-${action}`,
    signingSecret: SECRET,
  });
  return { id: 1, body: renderDecisionComment(decision, IDENTITY.label), user: { login: IDENTITY.botLogin } };
}

function setupClient({ directory = false, refs = [], files = {} } = {}) {
  const state = { trees: [], merges: [], closes: 0, blobs: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT" && pathname.endsWith("/merge")) {
      state.merges.push(pathname);
      return http({ merged: true });
    }
    if (method === "PATCH" && /\/pulls\/\d+$/.test(pathname)) {
      state.closes += 1;
      return http({ state: "closed" });
    }
    if (method === "GET" && pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (method === "GET" && pathname.includes("/git/matching-refs/")) return http(refs);
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      if (filePath === "projects/demo" && directory) return http([{ type: "dir", name: "project.yaml" }]);
      const sha = files[filePath];
      if (!sha) return http({ message: "Not Found" }, 404);
      return http({ type: "file", path: filePath, sha, encoding: "base64", content: Buffer.from("source\n").toString("base64") });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/ref/heads/")[1]);
      if (name === "main") return http({ object: { sha: "c".repeat(40) } });
      return http({ message: "Not Found" }, 404);
    }
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: "c".repeat(40), tree: { sha: "tree-base" } });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) {
      state.blobs.push(body);
      return http({ sha: "blob-1" });
    }
    if (method === "POST" && pathname.endsWith("/git/trees")) {
      state.trees.push(body);
      return http({ sha: "tree-new" });
    }
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "d".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/4", number: 4, head: { sha: "d".repeat(40) } });
    }
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      return http(pullFixture({ number: 4, headSha: "d".repeat(40), baseSha: "c".repeat(40), headRef: `setup/demo/${STAMP}` }));
    }
    if (method === "GET" && pathname.endsWith("/reviews")) return http([]);
    if (method === "GET" && pathname.endsWith("/comments")) return http([]);
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
  return { client, fetchImpl, state };
}

function rejectClient({ yaml, comments, action = "reject" }) {
  const issueComments = comments ?? [decisionComment(action)];
  const state = { trees: [], merges: [], blobs: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PUT" && pathname.endsWith("/merge")) {
      state.merges.push(pathname);
      return http({ merged: true });
    }
    if (method === "GET" && pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) return http(issueComments);
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      return http(pullFixture({ number: 12, headSha: HEAD, baseSha: "c".repeat(40), headRef: "setup/demo/old" }));
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      return http({
        type: "file",
        encoding: "base64",
        content: Buffer.from(yaml).toString("base64"),
        sha: "sha-yaml",
      });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/ref/heads/")[1]);
      if (name === "main") return http({ object: { sha: "c".repeat(40) } });
      return http({ message: "Not Found" }, 404);
    }
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: "c".repeat(40), tree: { sha: "tree-base" } });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) {
      state.blobs.push(body.content);
      return http({ sha: "blob-1" });
    }
    if (method === "POST" && pathname.endsWith("/git/trees")) {
      state.trees.push(body);
      return http({ sha: "tree-new" });
    }
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "e".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/14", number: 14, head: { sha: "e".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  const client = new GithubClient({
    fetchImpl,
    token: "test-token",
    owner: "o",
    repo: "r",
    identity: IDENTITY,
  });
  return { client, state };
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
