import { planSetupFollowUp } from "./tor-interview.mjs";

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
  const route = routeFor(projectState);
  if (!route || !event) return false;
  if (event.completedStage === "tor" && route.agent === "tor" && event.next === "project-planner") return true;
  if (event.completedStage === "project-plan" && route.agent === "project-planner" && event.next === "specification") return true;
  if (event.completedStage === "srs" && route.agent === "specification" && (event.next === null || event.next === undefined)) return true;
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
