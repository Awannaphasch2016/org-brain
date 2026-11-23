import { slackUserIdFromAuth } from "./authz.mjs";

const SLACK_ID = /^[UW][A-Z0-9]+$/;

export function forwardedSlackPrincipal({ userId, teamId, channelId, threadTs }) {
  if (typeof userId !== "string" || !SLACK_ID.test(userId)) {
    throw new Error("phase hop refuses a Slack actor that is not a user id");
  }
  const attributes = { user_id: userId };
  if (typeof channelId === "string" && channelId) attributes.channel_id = channelId;
  if (typeof threadTs === "string" && threadTs) attributes.thread_ts = threadTs;
  const current = {
    attributes,
    authenticator: "slack",
    principalId: typeof teamId === "string" && teamId ? `slack:${teamId}:${userId}` : `slack:${userId}`,
    principalType: "user",
  };
  return { current };
}

export function actorFromDecision(decision, { channelId, threadTs } = {}) {
  const match = typeof decision?.decidedBy === "string"
    ? decision.decidedBy.match(/^slack:([^:\s]+):([UW][A-Z0-9]+)$/)
    : null;
  if (!match) return null;
  return {
    userId: match[2],
    teamId: match[1],
    channelId: channelId ?? decision?.slack?.channel ?? null,
    threadTs: threadTs ?? null,
  };
}

function isSlackUser(context) {
  if (!context || context.authenticator !== "slack" || context.principalType !== "user") return false;
  const userId = slackUserIdFromAuth(context);
  return typeof userId === "string" && context.attributes?.user_id === userId;
}

export function phaseTrustedForwarders(forwarder, assertion) {
  if (forwarder?.authenticator !== "oidc") return false;
  if (forwarder.principalType !== "runtime" && forwarder.principalType !== "service") return false;
  const principal = assertion?.principal;
  return isSlackUser(principal?.current) && isSlackUser(principal?.initiator);
}

export function renderPhaseQuestion({ agent, sessionId, question }) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: String(question?.prompt ?? "") } },
  ];
  if (options.length > 0) {
    blocks.push({
      type: "actions",
      block_id: `phase:${sessionId}`.slice(0, 255),
      elements: options.map((option) => ({
        type: "button",
        action_id: `phase_answer:${option.id}`.slice(0, 255),
        text: { type: "plain_text", text: String(option.label ?? option.id).slice(0, 75) },
        value: JSON.stringify({
          schema: 1,
          kind: "phase-answer",
          agent,
          sessionId,
          interactionId: question.interactionId,
          optionId: option.id,
        }),
      })),
    });
  }
  return { text: String(question?.prompt ?? "Question"), blocks };
}

export function phaseAnswerFromAction(action) {
  if (typeof action?.actionId !== "string" || !action.actionId.startsWith("phase_answer:")) return null;
  let value;
  try {
    value = JSON.parse(action.value ?? "");
  } catch {
    return null;
  }
  if (value?.kind !== "phase-answer") return null;
  if (typeof value.agent !== "string" || typeof value.sessionId !== "string") return null;
  if (typeof value.interactionId !== "string" || typeof value.optionId !== "string") return null;
  return value;
}
