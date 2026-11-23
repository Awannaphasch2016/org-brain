import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveForwardedPrincipal } from "../node_modules/eve/dist/src/channel/forwarded-principal.js";
import { slackUserIdFromAuth } from "../lib/authz.mjs";
import { GithubClient } from "../lib/github.mjs";
import { loadProjectFiles } from "../lib/project-files.mjs";
import { actorFromDecision, forwardedSlackPrincipal, phaseAnswerFromAction, phaseTrustedForwarders, renderPhaseQuestion } from "../lib/phase-actor.mjs";
import { deliverPhaseOutput } from "../lib/orchestrator.mjs";
import { answerPhaseSession, readPhaseReply, startPhaseAgent } from "../lib/phase-hop.mjs";

const ANAK = "U0CFRUV378D";
const OTHER = "U0000000000";
const SHA = "a".repeat(40);

const oidcForwarder = {
  authenticator: "oidc",
  principalId: "owner:acme:project:factory:environment:production",
  principalType: "runtime",
  attributes: {},
};

test("a hopped TOR session loads a project as an allowlisted user", async () => {
  const calls = [];
  const started = await startPhaseAgent({
    agent: "tor",
    message: "Call load_tor_workspace first.",
    actor: { userId: ANAK, teamId: "T1", channelId: "C1", threadTs: "1.2" },
    env: { VERCEL_URL: "factory.example" },
    auth: { authorization: "Bearer test" },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "d1" }; } };
    },
  });
  const forwarded = calls[0].body.forwardedPrincipal;
  assert.equal(calls[0].url, "https://factory.example/eve/tor/v1/session");
  assert.equal(forwarded.current.attributes.user_id, ANAK);
  assert.equal(forwarded.current.attributes.channel_id, "C1");
  assert.equal(forwarded.current.attributes.thread_ts, "1.2");
  const accepted = await resolveForwardedPrincipal({
    trustedForwarders: phaseTrustedForwarders,
    forwarder: oidcForwarder,
    payload: { message: calls[0].body.message, forwardedPrincipal: forwarded },
  });
  assert.equal(accepted.accepted, true);
  const userId = slackUserIdFromAuth(accepted.auth);
  assert.equal(userId, ANAK);
  const loaded = await loadProjectFiles(projectClient().client, {
    projectId: "demo",
    ref: "main",
    userId,
    allowedUserIds: [ANAK],
  });
  assert.equal(loaded.denied, false);
  assert.equal(loaded.fetch, true);
  assert.equal(started.sessionId, "sess-tor");
  const tor = await readFile(new URL("../agents/tor/agent/channels/eve.ts", import.meta.url), "utf8");
  assert.match(tor, /trustedForwarders: phaseTrustedForwarders/);
});

test("a non-allowlisted forwarded user is still denied", async () => {
  const actor = { userId: OTHER, teamId: "T1", channelId: "C1", threadTs: "1.2" };
  const accepted = await resolveForwardedPrincipal({
    trustedForwarders: phaseTrustedForwarders,
    forwarder: oidcForwarder,
    payload: { forwardedPrincipal: forwardedSlackPrincipal(actor) },
  });
  assert.equal(accepted.accepted, true);
  const harness = projectClient();
  const denied = await loadProjectFiles(harness.client, {
    projectId: "demo",
    ref: "main",
    userId: slackUserIdFromAuth(accepted.auth),
    allowedUserIds: [ANAK],
  });
  assert.equal(denied.denied, true);
  assert.equal(denied.fetch, false);
  assert.equal(harness.calls.length, 0);
});

test("a body-supplied principal without valid OIDC is rejected", async () => {
  const payload = { forwardedPrincipal: forwardedSlackPrincipal({ userId: ANAK, teamId: "T1" }) };
  const local = await resolveForwardedPrincipal({
    trustedForwarders: phaseTrustedForwarders,
    forwarder: { authenticator: "local-dev", principalId: "local-dev", principalType: "local-dev", attributes: {} },
    payload,
  });
  assert.equal(local instanceof Response, true);
  assert.equal(local.status, 403);
  const unsigned = await resolveForwardedPrincipal({
    trustedForwarders: undefined,
    forwarder: oidcForwarder,
    payload,
  });
  assert.equal(unsigned instanceof Response, true);
  assert.equal(unsigned.status, 403);
  assert.equal(phaseTrustedForwarders(
    { authenticator: "oidc", principalType: "user", attributes: {} },
    { principal: { current: payload.forwardedPrincipal.current, initiator: payload.forwardedPrincipal.current } },
  ), false);
});

test("an ask_question posts to the bound thread and its answer returns to the same session", async () => {
  const posts = [];
  const calls = [];
  const env = { VERCEL_URL: "factory.example" };
  const auth = { authorization: "Bearer test" };
  const actor = { userId: ANAK, teamId: "T1", channelId: "C1", threadTs: "1.2" };
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (method === "GET") return questionStream();
    return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "d2" }; } };
  };
  const turn = await readPhaseReply({ agent: "tor", sessionId: "sess-tor", env, auth, fetchImpl });
  const card = renderPhaseQuestion({ agent: "tor", sessionId: "sess-tor", question: turn.question });
  await deliverPhaseOutput({
    question: turn.question,
    agent: "tor",
    sessionId: "sess-tor",
    threadTs: "1.2",
    post: async (payload) => posts.push(payload),
  });
  assert.equal(posts[0].threadTs, "1.2");
  assert.equal(posts[0].blocks[0].text.text, "What is the objective?");
  assert.equal(posts[0].blocks[1].elements[0].type, "button");
  const answer = phaseAnswerFromAction({ actionId: posts[0].blocks[1].elements[0].action_id, value: posts[0].blocks[1].elements[0].value });
  assert.equal(answer.sessionId, "sess-tor");
  assert.equal(answer.interactionId, "ask-1");
  const returned = await answerPhaseSession({ ...answer, actor, env, auth, fetchImpl });
  assert.equal(returned.sessionId, "sess-tor");
  assert.equal(calls.at(-1).url, "https://factory.example/eve/tor/v1/session/sess-tor");
  assert.deepEqual(calls.at(-1).body.answers, [{ interactionId: "ask-1", optionId: "track" }]);
  assert.equal(calls.at(-1).body.forwardedPrincipal.current.attributes.user_id, ANAK);
  assert.equal(calls.at(-1).body.message, undefined);
  assert.equal(card.blocks[1].elements.length, 2);
  assert.equal(actorFromDecision({ decidedBy: "slack:T1:U0CFRUV378D", slack: { channel: "C1" } }, { threadTs: "1.2" }).userId, ANAK);
});

function questionStream() {
  const line = `${JSON.stringify({
    at: "2026-11-23T00:00:00.000Z",
    facts: [
      {
        type: "interaction.opened",
        data: {
          interactionId: "ask-1",
          subject: { callId: "call-1" },
          request: {
            kind: "question",
            prompt: "What is the objective?",
            options: [
              { id: "track", label: "Track tasks" },
              { id: "plan", label: "Plan the release" },
            ],
          },
        },
      },
      { type: "turn.paused", data: { awaiting: [{ interactionId: "ask-1" }] } },
    ],
  })}\n`;
  const encoded = new TextEncoder().encode(line);
  return {
    ok: true,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoded };
          },
          async cancel() { sent = true; },
        };
      },
    },
  };
}

function projectClient() {
  const calls = [];
  const yaml = `id: demo
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
authorization:
  allowedSlackUserIds:
    - ${ANAK}
`;
  const files = { "projects/demo/project.yaml": yaml };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    if (parsed.pathname === "/repos/o/r/git/ref/heads/main") return http({ object: { sha: SHA } });
    if (parsed.pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(parsed.pathname.split("/contents/")[1]);
      const text = files[filePath];
      if (text == null) return http({ message: "missing" }, 404);
      return http({ encoding: "base64", content: Buffer.from(text).toString("base64"), type: "file" });
    }
    if (parsed.pathname.includes("/git/trees/")) {
      return http({ truncated: false, tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    }
    return http({ message: "missing" }, 404);
  };
  return { client: new GithubClient({ fetchImpl, token: "test-token", owner: "o", repo: "r" }), calls };
}

function http(body, status = 200) {
  return { ok: status < 300, status, async text() { return JSON.stringify(body); } };
}
