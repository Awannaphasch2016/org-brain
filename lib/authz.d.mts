export interface AuthzDecision {
  allowed: boolean;
  reason?: string;
}

export function authorizeSlackActor(input: {
  userId: string | null | undefined;
  allowedUserIds: readonly string[] | null | undefined;
}): AuthzDecision;

export function authorizeChannel(input: {
  channelId: string | null | undefined;
  allowedChannelIds: readonly string[] | null | undefined;
}): AuthzDecision;

export function authorizeProject(input: {
  userId: string | null | undefined;
  projectAllowedUserIds: readonly string[] | null | undefined;
}): AuthzDecision;

export function slackUserIdFromAuth(auth: {
  principalId?: string;
  attributes?: { user_id?: string };
} | null | undefined): string | null;

export function planLoadProject(input: {
  userId: string | null | undefined;
  allowedUserIds: readonly string[] | null | undefined;
  projectAllowedUserIds: readonly string[] | null | undefined;
}): { denied: boolean; fetch: boolean; reason?: string };
