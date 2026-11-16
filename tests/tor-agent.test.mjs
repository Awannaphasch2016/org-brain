import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDecision, renderDecisionComment } from "../lib/gate-decision.mjs";
import { GithubClient } from "../lib/github.mjs";
import { loadApprovedSrs, loadApprovedTor } from "../lib/project-files.mjs";
import { setYamlPath } from "../lib/project-yaml.mjs";
import { renderHashMismatchAlert } from "../lib/slack-gate.mjs";
import { bundledTorContract, torContractFields, torSectionsFromGuideline, validateIntake } from "../lib/intake-validate.mjs";
import { openTorDraft, recordTorBaseline } from "../lib/tor-draft.mjs";
import { nextInterviewQuestions, planTorInterview } from "../lib/tor-interview.mjs";
import { torAnswerResult, torInboundResult } from "../lib/tor-slack.mjs";
import { IDENTITY, pullFixture } from "./gate-harness.mjs";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const ANAK = "U0CFRUV378D";
const SECRET = "test-signing-secret";
const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const STAMP = "20261114T100000Z";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const before = `id: demo
title: Demo
status: active
tor:
  path: docs/tor.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
srs:
  path: docs/srs.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
    sourceTorCommit: null
architecture:
  path: docs/architecture.md
  status: none
  pullRequest: null
  branch: null
  baseline:
    mergeCommit: null
    approvedAt: null
    approvedBy: null
    sha256: null
    sourceSrsCommit: null
authorization:
  allowedSlackUserIds:
    - U0CFRUV378D
`;

test("record_tor_baseline hashes bytes at the merge commit, not HEAD", async () => {
  const mergeBytes = "bytes at the merge commit\n";
  const harness = recordingClient({
    headRef: "tor/demo/stamp",
    files: {
      "main:projects/demo/project.yaml": before,
      "main:projects/demo/docs/tor.md": "bytes at HEAD\n",
      [`${MERGE}:projects/demo/docs/tor.md`]: mergeBytes,
    },
  });
  const opened = await recordTorBaseline(harness.client, {
    projectId: "demo",
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  });
  assert.equal(opened.sha256, sha256(mergeBytes));
  assert.notEqual(opened.sha256, sha256("bytes at HEAD\n"));
  assert.equal(opened.branch, `tor/demo/baseline/${STAMP}`);
});

test("refuses unmerged or foreign PR", async () => {
  const unmerged = recordingClient({ headRef: "tor/demo/stamp", merged: false, files: {} });
  await assert.rejects(
    () => recordTorBaseline(unmerged.client, recordInput()),
    /not merged|before the pull request is merged/,
  );
  const foreign = recordingClient({
    headRef: "change/demo/stamp",
    files: { "main:projects/demo/project.yaml": before, [`${MERGE}:projects/demo/docs/tor.md`]: "x\n" },
  });
  await assert.rejects(() => recordTorBaseline(foreign.client, recordInput()), /foreign branch/);
});

test("revise opens a new stamped pull request and supersedes the old one", async () => {
  const harness = draftClient();
  const opened = await openTorDraft(harness.client, {
    projectId: "demo",
    stamp: STAMP,
    baseBranch: "main",
    grant: { agent: "tor", projectId: "demo", branchPrefix: "tor/demo/" },
    supersededPullNumber: 9,
    tor: await read("fixtures/test/p1-intake-complete/tor.md"),
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    elicitationLog: await read("fixtures/test/p1-intake-complete/tor-elicitation-log.md"),
    structureMarkdown: await read("knowledge/guidelines/tor-structure.md"),
    humanCommits: [
      {
        sha: "d".repeat(40),
        summary: "edit the draft",
        files: [{ filename: "projects/demo/docs/tor.md" }],
        additions: 2,
        deletions: 1,
      },
    ],
  });
  assert.equal(opened.branch, `tor/demo/${STAMP}`);
  assert.equal(harness.state.closes, 1);
  assert.equal(opened.merged, false);
  assert.match(opened.card.text, /edit the draft|Gate tor/);
  assert.match(JSON.stringify(opened.card.blocks), /edit the draft/);
  const paths = harness.state.trees[0].tree.map((entry) => entry.path).sort();
  assert.deepEqual(paths, [
    "projects/demo/docs/tor-analysis.md",
    "projects/demo/docs/tor-elicitation-log.md",
    "projects/demo/docs/tor.md",
  ]);
});

test("hash mismatch stops spec and architecture loaders and renders an alert", async () => {
  const torYaml = approvedYaml("tor");
  const tor = await loadApprovedTor(loaderClient(torYaml), {
    projectId: "demo",
    userId: ANAK,
    allowedUserIds: [ANAK],
    headRef: "main",
  });
  assert.equal(tor.stop, true);
  assert.equal(tor.reason, "tor-hash-mismatch");
  const srsYaml = approvedYaml("srs");
  const srs = await loadApprovedSrs(loaderClient(srsYaml, "srs"), {
    projectId: "demo",
    userId: ANAK,
    allowedUserIds: [ANAK],
    headRef: "main",
  });
  assert.equal(srs.stop, true);
  assert.equal(srs.reason, "srs-hash-mismatch");
  const alert = renderHashMismatchAlert({ projectId: "demo", reason: tor.reason });
  assert.equal(JSON.stringify(alert.blocks).includes('"type":"actions"'), false);
  assert.match(alert.text, /hash mismatch/);
});

test("the interview skill maps one question to each required field", async () => {
  const skill = await read("agents/tor/agent/skills/interview-tor/SKILL.md");
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const fields = [...skill.matchAll(/^-\s+field:\s+(.+?)\s+\|/gm)].map((match) => match[1]);
  const sections = [...skill.matchAll(/^-\s+section:\s+(\S+)\s+\|/gm)].map((match) => match[1]);
  const contract = torContractFields(bundledTorContract()).required.map((field) => field.name);
  const requiredSections = torSectionsFromGuideline(structure).required.map((section) => section.id);
  assert.deepEqual(fields, contract);
  assert.deepEqual(sections, requiredSections);
  assert.equal(new Set(fields).size, fields.length);
  assert.equal(new Set(sections).size, sections.length);
  for (const name of fields) assert.equal(skill.split(name).length - 1, 1, name);
  for (const id of sections) {
    const pattern = new RegExp(`(?<![0-9.])${id.replace(".", "\\.")}(?![0-9])`, "g");
    assert.equal(skill.match(pattern).length, 1, id);
  }
  assert.match(skill, /problem/);
  assert.match(skill, /objectives and outcomes/);
  assert.match(skill, /scope \(IS\/OS\)/);
  assert.match(skill, /stakeholders/);
});

test("instructions interview before validation and the pull request", async () => {
  const text = await read("agents/tor/agent/instructions.md");
  const interview = text.indexOf("interview-tor");
  const validate = text.indexOf("`validate_intake`");
  const pull = text.indexOf("`create_tor_pull_request`");
  assert.ok(interview > 0 && interview < validate && validate < pull);
  assert.match(text, /ask_question/);
  assert.match(text, /TEL-/);
  assert.match(text, /confirmed/);
  assert.match(text, /missing` or `draft/);
});

test("a one-line idea asks for every unconfirmed field and does not draft", async () => {
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const idea = "A small app to track team tasks";
  const plan = planTorInterview({
    tor: idea,
    analysis: "",
    elicitationLog: "",
    structureMarkdown: structure,
  });
  const expected = nextInterviewQuestions({ analysis: "", structureMarkdown: structure });
  assert.equal(plan.createTorPullRequest, false);
  assert.deepEqual(plan.tools, ["ask_question"]);
  assert.equal(plan.questions.length, expected.length);
  assert.ok(plan.questions.length > 10);
  const validation = validateIntake({ tor: idea, analysis: "", elicitationLog: "", structureMarkdown: structure });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.startsWith("unconfirmed required field:")));
});

test("interview questions follow the empty, partial, and complete fixtures", async () => {
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const empty = nextInterviewQuestions({
    analysis: await read("fixtures/test/p1-intake-empty/tor-analysis.md"),
    structureMarkdown: structure,
  });
  const partial = nextInterviewQuestions({
    analysis: await read("fixtures/test/p1-intake-partial/tor-analysis.md"),
    structureMarkdown: structure,
  });
  const complete = nextInterviewQuestions({
    analysis: await read("fixtures/test/p1-intake-complete/tor-analysis.md"),
    structureMarkdown: structure,
  });
  const contract = torContractFields(bundledTorContract()).required.map((field) => field.name);
  const sections = torSectionsFromGuideline(structure).required.map((section) => section.id);
  assert.deepEqual(empty.map((question) => question.id), [...contract, ...sections]);
  assert.ok(partial.some((question) => question.id === "1.1" && question.state === "draft"));
  assert.equal(partial.some((question) => question.id === "2.1"), true);
  assert.deepEqual(complete.map((question) => question.id), contract);
});

test("a draft is planned only after every answer is confirmed", async () => {
  const structure = await read("knowledge/guidelines/tor-structure.md");
  const tor = await read("fixtures/test/p1-intake-complete/tor.md");
  const contract = torContractFields(bundledTorContract()).required;
  const sections = torSectionsFromGuideline(structure).required;
  const analysis = `${await read("fixtures/test/p1-intake-complete/tor-analysis.md")}\n${contract
    .map((field) => `| ${field.label} | confirmed |`)
    .join("\n")}\n`;
  const elicitationLog = [...contract, ...sections]
    .map((item, index) => `## TEL-${String(index + 1).padStart(3, "0")}\n\nclass: clarification\nresolution: answered\n`)
    .join("\n");
  const ready = planTorInterview({ tor, analysis, elicitationLog, structureMarkdown: structure });
  assert.deepEqual(ready.tools, ["validate_intake", "create_tor_pull_request"]);
  assert.equal(ready.createTorPullRequest, true);
  assert.equal(ready.validation.ok, true, ready.validation.errors.join("\n"));
  const shortLog = planTorInterview({
    tor,
    analysis,
    elicitationLog: "## TEL-001\n\nclass: clarification\nresolution: answered\n",
    structureMarkdown: structure,
  });
  assert.equal(shortLog.createTorPullRequest, false);
  await assert.rejects(
    () => openTorDraft({ owner: "o", repo: "r", async request() { throw new Error("fetched"); } }, {
      projectId: "demo",
      stamp: STAMP,
      baseBranch: "main",
      grant: { agent: "tor", projectId: "demo", branchPrefix: "tor/demo/" },
      tor: "A small app to track team tasks",
      analysis: "",
      elicitationLog: "",
      structureMarkdown: structure,
    }),
    /intake fails|unconfirmed required field/,
  );
});

test("thread follow-ups cover setup and the interview", async () => {
  const source = await read("agents/tor/agent/channels/slack.ts");
  assert.match(source, /TOR setup and interview thread/);
  assert.match(source, /setup or the TOR interview/);
  const auth = { principalId: "slack:T0TEAM:U0CFRUV378D" };
  const guidance = "You are continuing a TOR setup and interview thread. Reply only when the message continues setup or the TOR interview. Otherwise call no_reply.";
  const deferred = torInboundResult({
    allowedUser: true,
    allowedChannel: true,
    approved: true,
    auth,
    inThread: true,
    subscribed: true,
    guidance,
  });
  assert.equal(deferred.status, "deferred");
  assert.match(deferred.guidance, /setup/);
  assert.match(deferred.guidance, /interview/);
  assert.equal(torInboundResult({ isBot: true, allowedUser: true, allowedChannel: true, approved: true, auth, guidance }), null);
  assert.equal(torAnswerResult({ allowedUser: true, allowedChannel: true, auth }).auth, auth);
  assert.equal(torAnswerResult({ allowedUser: false, allowedChannel: true, auth }), null);
  assert.equal(torInboundResult({ allowedUser: false, allowedChannel: true, approved: true, auth, inThread: true, subscribed: true, guidance }), null);
  assert.equal(torInboundResult({ allowedUser: true, allowedChannel: false, approved: true, auth, inThread: true, subscribed: true, guidance }), null);
});

function approvedYaml(block) {
  let yaml = setYamlPath(before, `${block}.status`, "approved");
  yaml = setYamlPath(yaml, `${block}.pullRequest`, 3);
  yaml = setYamlPath(yaml, `${block}.baseline.mergeCommit`, MERGE);
  return setYamlPath(yaml, `${block}.baseline.sha256`, "ab".repeat(32));
}

function recordInput() {
  return {
    projectId: "demo",
    pullNumber: 12,
    stamp: STAMP,
    allowedUserIds: [ANAK],
    signingSecret: SECRET,
    baseBranch: "main",
  };
}

function decisionComment() {
  const decision = buildDecision({
    projectId: "demo",
    stage: "tor",
    repo: "o/r",
    pr: 12,
    headSha: HEAD,
    baseSha: BASE,
    action: "approve",
    decidedBy: `slack:T0TEAM:${ANAK}`,
    decidedAt: "2026-11-14T10:00:00.000Z",
    slack: {
      channel: "C0CG6SG8PNW",
      ts: "1700000000.000100",
      permalink: null,
      verification: "hmac",
      requestTimestamp: "1700000000",
    },
    reason: null,
    humanCommits: [],
    idempotencyKey: "approved-tor-draft",
    signingSecret: SECRET,
  });
  return { id: 1, body: renderDecisionComment(decision, IDENTITY.label), user: { login: IDENTITY.botLogin } };
}

function recordingClient({ headRef, files, merged = true }) {
  const state = { merges: [] };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "GET" && /\/pulls\/\d+\/reviews$/.test(pathname)) return http([]);
    if (method === "GET" && /\/pulls\/\d+\/comments$/.test(pathname)) return http([]);
    if (method === "GET" && /\/issues\/\d+\/comments$/.test(pathname)) return http([decisionComment()]);
    if (method === "GET" && /\/pulls\/\d+$/.test(pathname)) {
      return http(pullFixture({
        number: 12,
        headSha: HEAD,
        baseSha: BASE,
        state: merged ? "closed" : "open",
        merged,
        mergeCommitSha: merged ? MERGE : null,
        headRef,
      }));
    }
    if (method === "GET" && pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const ref = parsed.searchParams.get("ref");
      const text = files[`${ref}:${filePath}`];
      if (text == null) return http({ message: "Not Found" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file", sha: "sha-file" });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/")) {
      const name = decodeURIComponent(pathname.split("/git/ref/heads/")[1]);
      if (name === "main") return http({ object: { sha: BASE } });
      return http({ message: "Not Found" }, 404);
    }
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: BASE, tree: { sha: "tree-base" } });
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) return http({ sha: "blob-1" });
    if (method === "POST" && pathname.endsWith("/git/trees")) return http({ sha: "tree-new" });
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "e".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/15", number: 15, head: { sha: "e".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return {
    state,
    client: new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r", identity: IDENTITY }),
  };
}

function draftClient() {
  const state = { trees: [], closes: 0 };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === "PATCH" && /\/pulls\/\d+$/.test(pathname)) {
      state.closes += 1;
      return http({ state: "closed" });
    }
    if (method === "GET" && pathname.includes("/git/ref/heads/main")) return http({ object: { sha: BASE } });
    if (method === "GET" && pathname.includes("/git/ref/heads/")) return http({ message: "Not Found" }, 404);
    if (method === "GET" && pathname.includes("/git/commits/")) return http({ sha: BASE, tree: { sha: "tree-base" } });
    if (method === "GET" && pathname.includes("/contents/")) return http({ message: "Not Found" }, 404);
    if (method === "POST" && pathname.endsWith("/git/refs")) return http({ ref: body.ref, object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/git/blobs")) return http({ sha: "blob-1" });
    if (method === "POST" && pathname.endsWith("/git/trees")) {
      state.trees.push(body);
      return http({ sha: "tree-new" });
    }
    if (method === "POST" && pathname.endsWith("/git/commits")) return http({ sha: "e".repeat(40) });
    if (method === "PATCH" && pathname.includes("/git/refs/heads/")) return http({ object: { sha: body.sha } });
    if (method === "POST" && pathname.endsWith("/pulls")) {
      return http({ html_url: "https://github.com/o/r/pull/16", number: 16, head: { sha: "e".repeat(40) } });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return { state, client: new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" }) };
}

function loaderClient(yaml, kind = "tor") {
  const head = "c".repeat(40);
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const { pathname } = parsed;
    if (pathname === "/repos/o/r") return http({ default_branch: "main" });
    if (pathname.includes("/git/ref/heads/main")) return http({ object: { sha: head } });
    if (pathname.includes("/git/trees/")) {
      const doc = kind === "srs" ? "projects/demo/docs/srs.md" : "projects/demo/docs/tor.md";
      return http({
        truncated: false,
        tree: [
          { path: "projects/demo/project.yaml", type: "blob" },
          { path: doc, type: "blob" },
        ],
      });
    }
    if (pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(pathname.split("/contents/")[1]);
      const text = filePath.endsWith("project.yaml") ? yaml : "different bytes\n";
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file", sha: "s" });
    }
    return http({ message: `unhandled ${method} ${pathname}` }, 500);
  };
  return new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" });
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
