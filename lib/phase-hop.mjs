import { vercelOidc } from "eve/agents/auth";
import { forwardedSlackPrincipal } from "./phase-actor.mjs";

const PHASE_AGENTS = new Set(["tor", "project-planner", "specification"]);

export const PHASE_AGENT_TOOL = {
  tor: "load_tor_workspace",
  "project-planner": "load_plan_workspace",
  specification: "load_project",
};

export function phaseAgentSessionUrl(agent, env = process.env) {
  if (!PHASE_AGENTS.has(agent)) throw new Error(`phase hop refuses unknown agent: ${agent}`);
  const host = env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL : env.VERCEL_URL;
  if (!host) {
    throw new Error("phase hop failed closed: VERCEL_URL or VERCEL_PROJECT_PRODUCTION_URL is not set");
  }
  const proto = env.VERCEL_ENV === "development" ? "http" : "https";
  return `${proto}://${host}/eve/${agent}/v1/session`;
}

export function phaseTaskMessage({ agent, projectId, text, threadTs }) {
  const tool = PHASE_AGENT_TOOL[agent];
  return [
    `Project ${projectId}.`,
    threadTs ? `Slack thread ${threadTs}.` : "",
    `Call ${tool} first.`,
    "Do not wait for another Slack message.",
    text ? `User message: ${text}` : "",
  ].filter(Boolean).join(" ");
}

export function phaseSessionContinueUrl(agent, sessionId, env = process.env) {
  return `${phaseAgentSessionUrl(agent, env)}/${encodeURIComponent(sessionId)}`;
}

export function phaseSessionStreamUrl(agent, sessionId, env = process.env) {
  return `${phaseSessionContinueUrl(agent, sessionId, env)}/stream`;
}

async function hopHeaders(auth) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    Object.assign(headers, auth);
    return headers;
  }
  let tokenHeaders;
  try {
    tokenHeaders = (await vercelOidc()()).headers;
  } catch {
    tokenHeaders = null;
  }
  if (!tokenHeaders?.authorization) {
    throw new Error("phase hop failed closed: VERCEL_OIDC_TOKEN is not available");
  }
  Object.assign(headers, tokenHeaders);
  return headers;
}

function sessionPayload({ message, answers, actor }) {
  const payload = {};
  if (message != null) payload.message = message;
  if (answers) payload.answers = answers;
  if (actor) payload.forwardedPrincipal = forwardedSlackPrincipal(actor);
  return payload;
}

export async function startPhaseAgent({ agent, message, actor, env = process.env, fetchImpl = fetch, auth } = {}) {
  const url = phaseAgentSessionUrl(agent, env);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: await hopHeaders(auth),
    body: JSON.stringify(sessionPayload({ message, actor })),
  });
  if (!response.ok) throw new Error(`phase hop to ${agent} failed: ${response.status}`);
  const body = await response.json();
  if (typeof body?.sessionId !== "string" || !body.sessionId) {
    throw new Error(`phase hop to ${agent} did not return a session id`);
  }
  return {
    agent,
    sessionId: body.sessionId,
    deliveryId: body.deliveryId ?? null,
    tool: PHASE_AGENT_TOOL[agent],
    url,
  };
}

export async function continuePhaseSession({ agent, sessionId, message, answers, actor, env = process.env, fetchImpl = fetch, auth } = {}) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("phase hop continuation requires a session id");
  const url = phaseSessionContinueUrl(agent, sessionId, env);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: await hopHeaders(auth),
    body: JSON.stringify(sessionPayload({ message, answers, actor })),
  });
  if (!response.ok) throw new Error(`phase hop continuation to ${agent} failed: ${response.status}`);
  const body = await response.json();
  const continued = typeof body?.sessionId === "string" && body.sessionId ? body.sessionId : sessionId;
  if (continued !== sessionId) throw new Error(`phase hop resumed ${continued} instead of ${sessionId}`);
  return {
    agent,
    sessionId,
    deliveryId: body?.deliveryId ?? null,
    tool: PHASE_AGENT_TOOL[agent],
    url,
  };
}

export async function answerPhaseSession({ agent, sessionId, interactionId, optionId, actor, env = process.env, fetchImpl = fetch, auth } = {}) {
  return continuePhaseSession({
    agent,
    sessionId,
    answers: [{ interactionId, optionId }],
    actor,
    env,
    fetchImpl,
    auth,
  });
}

export async function readPhaseReply({ agent, sessionId, env = process.env, fetchImpl = fetch, auth } = {}) {
  return readPhaseStream({ agent, sessionId, env, fetchImpl, auth });
}

export async function readPhaseFollowUp({ agent, sessionId, answeredInteractionId, env = process.env, fetchImpl = fetch, auth } = {}) {
  return readPhaseStream({ agent, sessionId, answeredInteractionId, env, fetchImpl, auth });
}

async function readPhaseStream({ agent, sessionId, answeredInteractionId, env, fetchImpl, auth }) {
  const response = await fetchImpl(phaseSessionStreamUrl(agent, sessionId, env), {
    method: "GET",
    headers: await hopHeaders(auth),
  });
  if (!response.ok) throw new Error(`phase hop stream for ${agent} failed: ${response.status}`);
  return collectPhaseReply(response, answeredInteractionId);
}

async function collectPhaseReply(response, answeredInteractionId) {
  const state = { parts: [], question: null, answeredInteractionId, seenAnswered: false, afterAnswer: !answeredInteractionId };
  if (!response.body?.getReader) return replyFromNdjson(await response.text(), state);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (consumeReplyLine(line, state)) return turnFrom(state);
      }
      if (done) {
        if (buffer) consumeReplyLine(buffer, state);
        return turnFrom(state);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function replyFromNdjson(text, state) {
  for (const line of String(text ?? "").split("\n")) consumeReplyLine(line, state);
  return turnFrom(state);
}

function turnFrom(state) {
  return { reply: state.parts.join(""), question: state.question };
}

function consumeReplyLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  let row;
  try {
    row = JSON.parse(trimmed);
  } catch {
    return false;
  }
  let done = false;
  for (const fact of row.facts ?? []) {
    if (state.answeredInteractionId) {
      if (followAnsweredFact(fact, state)) done = true;
      continue;
    }
    if (
      fact?.type === "content.completed"
      && fact.data?.kind === "text"
      && fact.data?.phase === "reply"
      && typeof fact.data.value === "string"
    ) {
      state.parts.push(fact.data.value);
    }
    if (fact?.type === "interaction.opened" && fact.data?.request?.kind === "question" && !state.question) {
      state.question = questionFromFact(fact);
    }
    if (fact?.type === "turn.paused" || fact?.type === "turn.settled") done = true;
  }
  return done;
}

function followAnsweredFact(fact, state) {
  if (fact?.type === "interaction.opened" && fact.data?.interactionId === state.answeredInteractionId) {
    state.seenAnswered = true;
    state.afterAnswer = false;
    state.question = null;
    return false;
  }
  if (fact?.type === "turn.paused" && state.seenAnswered && !state.afterAnswer) {
    state.afterAnswer = true;
    return false;
  }
  if (!state.afterAnswer) return false;
  if (
    fact?.type === "content.completed"
    && fact.data?.kind === "text"
    && fact.data?.phase === "reply"
    && typeof fact.data.value === "string"
  ) {
    state.parts.push(fact.data.value);
  }
  if (fact?.type === "interaction.opened" && fact.data?.request?.kind === "question" && !state.question) {
    state.question = questionFromFact(fact);
  }
  if (fact?.type === "turn.paused" && state.question) return true;
  return fact?.type === "turn.settled";
}

function questionFromFact(fact) {
  return {
    interactionId: fact.data.interactionId,
    prompt: fact.data.request.prompt ?? "",
    options: Array.isArray(fact.data.request.options)
      ? fact.data.request.options.filter((option) => option?.id).map((option) => ({ id: option.id, label: option.label ?? option.id }))
      : [],
  };
}
