import { vercelOidc } from "eve/agents/auth";

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

export async function startPhaseAgent({ agent, message, env = process.env, fetchImpl = fetch, auth } = {}) {
  const url = phaseAgentSessionUrl(agent, env);
  const headers = { "content-type": "application/json" };
  if (auth) {
    Object.assign(headers, auth);
  } else {
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
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
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
