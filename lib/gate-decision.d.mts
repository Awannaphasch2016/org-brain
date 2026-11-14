export const DECISION_SCHEMA: number;
export const DECISION_KIND: string;
export const PENDING_KIND: string;
export const REASON_PROMPT: string;

export function gateIdempotencyKey(input: {
  repo: string;
  pr: number;
  teamId: string;
  channel: string;
  messageTs: string;
  userId: string;
  action: string;
  headSha: string;
}): string;

export function decisionMac(decision: Record<string, any>, signingSecret: string): string;

export function buildDecision(input: Record<string, any>): Record<string, any>;
export function renderDecisionComment(decision: Record<string, any>, identityLabel?: string | null): string;
export function buildPending(input: Record<string, any>): Record<string, any>;
export function renderPendingComment(pending: Record<string, any>, identityLabel?: string | null): string;
export function parseFencedRecord(body: string, kind: string): Record<string, any> | null;
export function parseDecisionComment(
  body: string,
): { ok: true; decision: Record<string, any> } | { ok: false; reason: string };
export function slackUserIdFromDecidedBy(decidedBy: string): string | null;
export function verifyGateDecision(input: {
  comment: { body: string; authorLogin: string | null } | null;
  expectedAuthorLogin: string | null;
  repo: string;
  pullNumber: number;
  liveHeadSha: string;
  allowedUserIds: readonly string[];
  projectId?: string;
  signingSecret?: string;
  requireMac?: boolean;
  ciGreen?: boolean;
  requireCi?: boolean;
  expectedAction?: "approve" | "reject" | "revise";
}): {
  ok: boolean;
  reason?: string;
  decision?: Record<string, any>;
  verified?: { decision: Record<string, any> };
  authorization?: { kind: "gate"; repo: string; pr: number; headSha: string };
};
export function ciIsGreen(input: {
  combinedState: string | null | undefined;
  checkRuns: readonly { name?: string; status?: string; conclusion?: string | null }[];
  requiredCheckName?: string;
}): boolean;
