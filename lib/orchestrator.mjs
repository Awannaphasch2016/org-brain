import { parseFencedRecord } from "./gate-decision.mjs";
import { readRepoTextFile } from "./github.mjs";
import { phaseTaskMessage, startPhaseAgent } from "./phase-hop.mjs";
import { parseSimpleYaml } from "./project-yaml.mjs";
import { planSetupFollowUp } from "./tor-interview.mjs";

export const THREAD_PROJECT_KIND = "factory-thread-project";

export function renderThreadProjectBinding({ projectId, threadTs }) {
  return ["```json", JSON.stringify({ schema: 1, kind: THREAD_PROJECT_KIND, projectId, threadTs: threadTs ?? null }, null, 2), "```", ""].join("\n");
}

export function projectIdFromThread(messages) {
  for (const message of [...(messages ?? [])].reverse()) {
    const text = message?.text ?? message?.body ?? "";
    const record = parseFencedRecord(text, THREAD_PROJECT_KIND);
    if (typeof record?.projectId === "string" && record.projectId) return record.projectId;
  }
  return null;
}

export const BOT_IDENTITY = "ISO Workflows";
export const PHASE_REQUEST_URL = "https://wewebplus-software-factory.vercel.app/eve/specification/v1/slack";

export const PHASE_SEQUENCE = [
  { phase: "setup", step: "tor", agent: "tor" },
  { phase: "tor", step: "project-planner", agent: "project-planner" },
  { phase: "project-planner", step: "specification", agent: "specification" },
];

const DOCUMENTS = ["tor", "projectPlan", "srs"];

function statusOf(projectState, key) {
  return projectState?.[key]?.status ?? "none";
}

export function routeFor(projectState) {
  if (!projectState || projectState.status === "rejected") return null;
  if (DOCUMENTS.some((key) => statusOf(projectState, key) === "rejected")) return null;
  if (statusOf(projectState, "srs") === "needs-review") return PHASE_SEQUENCE[2];
  if (statusOf(projectState, "srs") === "approved") return null;
  if (statusOf(projectState, "projectPlan") === "approved") return PHASE_SEQUENCE[2];
  if (statusOf(projectState, "tor") === "approved") return PHASE_SEQUENCE[1];
  return PHASE_SEQUENCE[0];
}

function cloneState(projectState) {
  return JSON.parse(JSON.stringify(projectState));
}

export function createWorkflowThread(projectState) {
  return {
    bot: BOT_IDENTITY,
    requestUrl: PHASE_REQUEST_URL,
    projectState: cloneState(projectState),
    messages: [],
  };
}

function agentPost(thread, agent, text, source) {
  thread.messages.push({ role: "agent", agent, bot: thread.bot, text, source });
}

export function postSlackMessage(thread, text) {
  const route = routeFor(thread.projectState);
  const before = thread.projectState;
  thread.messages.push({ role: "user", text, agent: route?.agent ?? null });
  if (route) {
    agentPost(thread, route.agent, `ISO Workflows received that for ${route.agent}.`, "slack-message");
  }
  return {
    agent: route?.agent ?? null,
    advanced: false,
    posted: Boolean(route),
    requestUrl: thread.requestUrl,
    projectState: before,
  };
}

function transitionMatches(projectState, event) {
  if (!projectState || !event) return false;
  const route = routeFor(projectState);
  const torStatus = statusOf(projectState, "tor");
  const planStatus = statusOf(projectState, "projectPlan");
  const srsStatus = statusOf(projectState, "srs");
  if (event.completedStage === "setup" && event.next === "tor") return route?.agent === "tor";
  if (event.completedStage === "tor" && event.next === "project-planner") {
    if (route?.agent === "tor" && torStatus !== "approved") return true;
    return torStatus === "approved" && route?.agent === "project-planner";
  }
  if (event.completedStage === "project-plan" && event.next === "specification") {
    if (route?.agent === "project-planner" && planStatus !== "approved") return true;
    return planStatus === "approved" && route?.agent === "specification";
  }
  if (event.completedStage === "srs" && (event.next === null || event.next === undefined)) {
    if (route?.agent === "specification" && srsStatus !== "approved") return true;
    return srsStatus === "approved" && route == null;
  }
  return false;
}

function withApproved(projectState, key) {
  const next = cloneState(projectState);
  next[key] = { ...(next[key] ?? {}), status: "approved" };
  return next;
}

export function applyGateEvent(thread, event) {
  const setup = planSetupFollowUp(event);
  if (setup) {
    const route = routeFor(thread.projectState);
    if (route?.agent !== "tor") return { advanced: false, agent: route?.agent ?? null, posted: false, requestUrl: thread.requestUrl };
    agentPost(thread, "tor", setup.prompt, "gate-event");
    return { advanced: false, agent: "tor", posted: true, requestUrl: thread.requestUrl };
  }
  if (!transitionMatches(thread.projectState, event)) {
    return { advanced: false, agent: routeFor(thread.projectState)?.agent ?? null, posted: false, requestUrl: thread.requestUrl };
  }
  if (event.completedStage === "tor") thread.projectState = withApproved(thread.projectState, "tor");
  if (event.completedStage === "project-plan") thread.projectState = withApproved(thread.projectState, "projectPlan");
  if (event.completedStage === "srs") thread.projectState = withApproved(thread.projectState, "srs");
  const route = routeFor(thread.projectState);
  if (route) {
    agentPost(
      thread,
      route.agent,
      `${route.agent} is starting from the gate transition. No user message is required.`,
      "gate-event",
    );
  }
  return { advanced: true, agent: route?.agent ?? null, posted: Boolean(route), requestUrl: thread.requestUrl };
}

export function projectIdFromSlackText(text) {
  const match = String(text ?? "").match(/\bProject `([a-z0-9][a-z0-9-]*)`/);
  return match?.[1] ?? null;
}

export async function loadOrchestratorProject(client, projectId) {
  const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
  const ref = repository?.default_branch;
  if (typeof ref !== "string" || !ref) return null;
  const yaml = await readRepoTextFile(client, `projects/${projectId}/project.yaml`, ref);
  if (!yaml) return null;
  return parseSimpleYaml(yaml);
}

export function dispatchSpecificationInbound({ projectState, text, requestUrl = PHASE_REQUEST_URL }) {
  const route = routeFor(projectState);
  return {
    agent: route?.agent ?? null,
    phase: route?.phase ?? null,
    step: route?.step ?? null,
    advanced: false,
    requestUrl,
    bot: BOT_IDENTITY,
    text,
    prompt: route ? `${BOT_IDENTITY} routed this message to ${route.agent}. ${text}` : null,
    projectState,
  };
}

export async function startFromTransition(projectState, event, startAgent = startPhaseAgent) {
  if (!transitionMatches(projectState, event) || !event?.next) {
    return { advanced: false, agent: null, invoked: null, event, messages: [] };
  }
  const message = phaseTaskMessage({
    agent: event.next,
    projectId: event.projectId ?? projectState?.id,
  });
  const invoked = await startAgent({ agent: event.next, message });
  return {
    advanced: true,
    agent: event.next,
    invoked,
    event,
    messages: [{ role: "agent", agent: event.next, source: "session", text: message }],
  };
}

export async function handleSpecificationInbound({ projectState, text, threadMessages, startAgent = startPhaseAgent, requestUrl = PHASE_REQUEST_URL }) {
  const projectId = projectIdFromThread(threadMessages) ?? projectState?.id;
  const dispatched = dispatchSpecificationInbound({ projectState, text, requestUrl });
  if (!dispatched.agent) return { ...dispatched, invoked: null, projectId };
  const message = phaseTaskMessage({ agent: dispatched.agent, projectId, text });
  const invoked = await startAgent({ agent: dispatched.agent, message });
  return { ...dispatched, advanced: false, invoked, projectId };
}
