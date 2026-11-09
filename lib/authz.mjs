const SLACK_ID = /^[UW][A-Z0-9]+$/;

export function authorizeSlackActor({ userId, allowedUserIds }) {
  if (!Array.isArray(allowedUserIds) || allowedUserIds.length === 0) {
    return {
      allowed: false,
      reason: "fail-closed: allowedUserIds is empty, so nobody is authorized",
    };
  }
  if (typeof userId !== "string" || !SLACK_ID.test(userId) || !allowedUserIds.includes(userId)) {
    return { allowed: false, reason: "user is not on the Slack allowlist" };
  }
  return { allowed: true };
}

export function authorizeChannel({ channelId, allowedChannelIds }) {
  if (!Array.isArray(allowedChannelIds) || allowedChannelIds.length === 0) {
    return {
      allowed: false,
      reason: "fail-closed: allowedChannelIds is empty, so nobody is authorized",
    };
  }
  if (typeof channelId !== "string" || !allowedChannelIds.includes(channelId)) {
    return { allowed: false, reason: "channel is not on the allowlist" };
  }
  return { allowed: true };
}

export function authorizeProject({ userId, projectAllowedUserIds }) {
  if (!Array.isArray(projectAllowedUserIds) || projectAllowedUserIds.length === 0) {
    return {
      allowed: false,
      reason: "fail-closed: project authorization.allowedSlackUserIds is empty",
    };
  }
  if (
    typeof userId !== "string" ||
    !SLACK_ID.test(userId) ||
    !projectAllowedUserIds.includes(userId)
  ) {
    return { allowed: false, reason: "user is not authorized for this project" };
  }
  return { allowed: true };
}

export function slackUserIdFromAuth(auth) {
  if (!auth || typeof auth !== "object") return null;
  const attribute = auth.attributes?.user_id;
  if (typeof attribute === "string" && SLACK_ID.test(attribute)) return attribute;
  if (typeof auth.principalId !== "string") return null;
  const match = auth.principalId.match(/^slack:(?:[^:]+:)?([UW][A-Z0-9]+)$/);
  return match?.[1] ?? null;
}

/**
 * Authorization runs before any project fetch. A denial does not hydrate files.
 */
export function planLoadProject({ userId, allowedUserIds, projectAllowedUserIds }) {
  const actor = authorizeSlackActor({ userId, allowedUserIds });
  if (!actor.allowed) return { denied: true, fetch: false, reason: actor.reason };
  const project = authorizeProject({ userId, projectAllowedUserIds });
  if (!project.allowed) return { denied: true, fetch: false, reason: project.reason };
  return { denied: false, fetch: true };
}
