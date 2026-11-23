import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { vercelOidc } from "eve/channels/auth";
import { resolveForwardedPrincipal } from "../node_modules/eve/dist/src/channel/forwarded-principal.js";
import { slackUserIdFromAuth } from "../lib/authz.mjs";
import { GithubClient } from "../lib/github.mjs";
import { loadProjectFiles } from "../lib/project-files.mjs";
import { actorFromDecision, forwardedSlackPrincipal, phaseAnswerFromAction, phaseTrustedForwarders, renderPhaseQuestion } from "../lib/phase-actor.mjs";
import { deliverAnsweredPhase, deliverPhaseOutput } from "../lib/orchestrator.mjs";
import { answerPhaseSession, readPhaseReply, startPhaseAgent } from "../lib/phase-hop.mjs";

const ANAK = "U0CFRUV378D";
const OTHER = "U0000000000";
const SHA = "a".repeat(40);
const PROJECT = "prj_D4lCsHuXRH1ZLAXvliq5BkCDHwbm";
const ISSUER = "https://oidc.vercel.com/anak2";

function deploymentForwarder(overrides = {}) {
  return {
    authenticator: "oidc",
    issuer: ISSUER,
    principalId: `${ISSUER}:owner:anak2:project:org-brain:environment:production`,
    principalType: "runtime",
    subject: "owner:anak2:project:org-brain:environment:production",
    attributes: { project_id: PROJECT, environment: "production" },
    ...overrides,
    attributes: { project_id: PROJECT, environment: "production", ...overrides.attributes },
  };
}

const oidcForwarder = deploymentForwarder();
const deploymentEnv = { VERCEL_PROJECT_ID: PROJECT, VERCEL_ENV: "production" };

function slackAssertion(userId = ANAK) {
  const current = forwardedSlackPrincipal({ userId, teamId: "T1" }).current;
  return { principal: { current, initiator: current } };
}

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
  const accepted = await withDeploymentEnv(() => resolveForwardedPrincipal({
    trustedForwarders: phaseTrustedForwarders,
    forwarder: oidcForwarder,
    payload: { message: calls[0].body.message, forwardedPrincipal: forwarded },
  }));
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
  const accepted = await withDeploymentEnv(() => resolveForwardedPrincipal({
    trustedForwarders: phaseTrustedForwarders,
    forwarder: oidcForwarder,
    payload: { forwardedPrincipal: forwardedSlackPrincipal(actor) },
  }));
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
    deploymentEnv,
  ), false);
});

test("the phase eve channels use vercelOidc() as their only OIDC route-auth acceptor", async () => {
  for (const agent of ["tor", "project-planner", "specification"]) {
    const source = await readFile(new URL(`../agents/${agent}/agent/channels/eve.ts`, import.meta.url), "utf8");
    assert.match(source, /import \{ localDev, vercelOidc \} from "eve\/channels\/auth";/);
    assert.match(source, /auth:\s*\[vercelOidc\(\), localDev\(\)\]/);
    assert.match(source, /trustedForwarders:\s*phaseTrustedForwarders/);
    assert.equal(source.replaceAll("vercelOidc", "").includes("oidc("), false);
    assert.equal(source.includes("jwtHmac"), false);
    assert.equal(source.includes("jwtEcdsa"), false);
    assert.equal(source.includes("verifyOidc"), false);
  }
});

test("vercelOidc() rejects a token with the wrong audience", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const claims = {
    iss: ISSUER,
    sub: "owner:anak2:project:org-brain:environment:production",
    project_id: PROJECT,
    environment: "production",
  };
  const authenticate = vercelOidc();
  const fetches = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    fetches.push(String(url));
    return new Response("discovery unavailable", { status: 503 });
  };
  try {
    const wrong = await authenticate(bearerRequest(signJwt(privateKey, { ...claims, aud: "https://evil.example/anak2" })));
    assert.equal(wrong, null);
    assert.deepEqual(fetches, []);
    const rightAudience = await authenticate(bearerRequest(signJwt(privateKey, { ...claims, aud: "https://vercel.com/anak2" })));
    assert.equal(rightAudience, null);
    assert.equal(fetches.length > 0, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("a phase answer click delivers the next turn after the Slack ack", async () => {
  const starter = "U1111111111";
  const clicker = "U2222222222";
  const allowed = [starter, clicker];
  assert.notEqual(clicker, starter);
  assert.equal(allowed.includes(clicker), true);
  const slack = await readFile(new URL("../agents/specification/agent/channels/slack.ts", import.meta.url), "utf8");
  const handler = slack.slice(slack.indexOf("onInteraction"));
  const allowAt = handler.indexOf("allowUser(action.user.id)");
  const deliverAt = handler.indexOf("return deliverAnsweredPhase(");
  assert.equal(allowAt > 0 && deliverAt > allowAt, true);
  const interactions = await readFile(new URL("../node_modules/eve/dist/src/public/channels/slack/interactions.js", import.meta.url), "utf8");
  const scheduledAt = interactions.indexOf("t.waitUntil(dispatchCustomInteractions");
  const ackAt = interactions.indexOf("return r", scheduledAt);
  assert.equal(scheduledAt > 0 && ackAt > scheduledAt, true);

  const env = { VERCEL_URL: "factory.example" };
  const auth = { authorization: "Bearer test" };
  const calls = [];
  let transcript = interviewTranscript("ask-2");
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (method === "POST") return { ok: true, async json() { return { sessionId: "sess-tor", deliveryId: "d-answer" }; } };
    return factStream(transcript);
  };
  const posts = [];
  let acked = false;
  let scheduled;
  const waitUntil = (task) => { scheduled = task; };
  waitUntil(deliverAnsweredPhase({
    answer: { agent: "tor", sessionId: "sess-tor", interactionId: "ask-1", optionId: "track" },
    actor: { userId: clicker, teamId: "T1", channelId: "C1", threadTs: "1.2" },
    threadTs: "1.2",
    env,
    auth,
    fetchImpl,
    post: async (payload) => posts.push(payload),
  }));
  acked = true;
  assert.equal(acked, true);
  assert.equal(posts.length, 0);
  assert.equal(calls.length, 0);
  await scheduled;
  assert.equal(calls[0].url, "https://factory.example/eve/tor/v1/session/sess-tor");
  assert.deepEqual(calls[0].body.answers, [{ interactionId: "ask-1", optionId: "track" }]);
  assert.equal(calls[0].body.forwardedPrincipal.current.attributes.user_id, clicker);
  assert.notEqual(calls[0].body.forwardedPrincipal.current.attributes.user_id, starter);
  assert.equal(posts[0].threadTs, "1.2");
  assert.equal(posts[0].blocks[0].text.text, "How large is the team?");
  assert.equal(calls.some((call) => call.method === "GET" && call.url.endsWith("/sess-tor/stream")), true);

  transcript = interviewTranscript("settled");
  const secondPosts = [];
  let second;
  waitUntil(deliverAnsweredPhase({
    answer: { agent: "tor", sessionId: "sess-tor", interactionId: "ask-2", optionId: "small" },
    actor: { userId: clicker, teamId: "T1", channelId: "C1", threadTs: "1.2" },
    threadTs: "1.2",
    env,
    auth,
    fetchImpl,
    post: async (payload) => secondPosts.push(payload),
  }));
  assert.equal(secondPosts.length, 0);
  second = await scheduled;
  assert.equal(second.reply, "TOR drafted.");
  assert.equal(second.question, null);
  assert.equal(secondPosts[0].threadTs, "1.2");
  assert.equal(secondPosts[0].text, "TOR drafted.");
  const answers = calls.filter((call) => call.method === "POST");
  assert.equal(answers.length, 2);
  assert.deepEqual(answers[1].body.answers, [{ interactionId: "ask-2", optionId: "small" }]);
  assert.equal(answers.every((call) => call.body.forwardedPrincipal.current.attributes.user_id === clicker), true);
});

test("the predicate rejects another project, environment, or issuer", () => {
  const assertion = slackAssertion();
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder({ attributes: { project_id: "prj_other", environment: "production" } }),
    assertion,
    deploymentEnv,
  ), false);
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder({ attributes: { project_id: PROJECT, environment: "preview" } }),
    assertion,
    deploymentEnv,
  ), false);
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder({ issuer: "https://oidc.vercel.com/other-team" }),
    assertion,
    deploymentEnv,
  ), false);
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder(),
    assertion,
    { VERCEL_PROJECT_ID: PROJECT, VERCEL_TARGET_ENV: "preview", VERCEL_ENV: "production" },
  ), false);
});

test("a fully matching forwarder is accepted", () => {
  assert.equal(phaseTrustedForwarders(deploymentForwarder(), slackAssertion(), deploymentEnv), true);
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder({ principalType: "service" }),
    slackAssertion(),
    { VERCEL_PROJECT_ID: PROJECT, VERCEL_TARGET_ENV: "production" },
  ), true);
});

test("a missing VERCEL_PROJECT_ID or environment variable fails closed", () => {
  const assertion = slackAssertion();
  const forwarder = deploymentForwarder();
  assert.equal(phaseTrustedForwarders(forwarder, assertion, { VERCEL_ENV: "production" }), false);
  assert.equal(phaseTrustedForwarders(forwarder, assertion, { VERCEL_PROJECT_ID: PROJECT }), false);
  assert.equal(phaseTrustedForwarders(forwarder, assertion, { VERCEL_PROJECT_ID: "", VERCEL_ENV: "production" }), false);
  assert.equal(phaseTrustedForwarders(forwarder, assertion, { VERCEL_PROJECT_ID: "prj_other", VERCEL_ENV: "production" }), false);
  assert.equal(phaseTrustedForwarders(
    deploymentForwarder({ attributes: { project_id: PROJECT, environment: undefined } }),
    assertion,
    deploymentEnv,
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

async function withDeploymentEnv(run) {
  const previous = {
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
  };
  process.env.VERCEL_PROJECT_ID = PROJECT;
  process.env.VERCEL_ENV = "production";
  delete process.env.VERCEL_TARGET_ENV;
  try {
    return await run();
  } finally {
    restoreEnv("VERCEL_PROJECT_ID", previous.VERCEL_PROJECT_ID);
    restoreEnv("VERCEL_ENV", previous.VERCEL_ENV);
    restoreEnv("VERCEL_TARGET_ENV", previous.VERCEL_TARGET_ENV);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function signJwt(privateKey, payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${part({ alg: "RS256", typ: "JWT" })}.${part(payload)}`;
  const signature = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${signature}`;
}

function bearerRequest(token) {
  return new Request("https://factory.example/eve/tor/v1/session", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function interviewTranscript(stage) {
  const facts = [
    questionFact("ask-1", "What is the objective?", [{ id: "track", label: "Track tasks" }]),
    { type: "turn.paused", data: { awaiting: [{ interactionId: "ask-1" }] } },
  ];
  if (stage === "ask-2" || stage === "settled") {
    facts.push(
      questionFact("ask-2", "How large is the team?", [{ id: "small", label: "Small" }]),
      { type: "turn.paused", data: { awaiting: [{ interactionId: "ask-2" }] } },
    );
  }
  if (stage === "settled") {
    facts.push(
      { type: "content.completed", data: { kind: "text", phase: "reply", value: "TOR drafted." } },
      { type: "turn.settled", data: { outcome: "completed" } },
    );
  }
  return facts;
}

function questionFact(interactionId, prompt, options) {
  return {
    type: "interaction.opened",
    data: { interactionId, subject: { callId: "call-1" }, request: { kind: "question", prompt, options } },
  };
}

function factStream(facts) {
  const encoded = new TextEncoder().encode(`${JSON.stringify({ at: "2026-11-23T00:00:00.000Z", facts })}\n`);
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
