export const PHASE_AGENT_TOOL: Record<string, string>;

export function phaseAgentSessionUrl(agent: string, env?: Record<string, string | undefined>): string;

export function phaseTaskMessage(input: {
  agent: string;
  projectId?: string;
  text?: string;
  threadTs?: string;
}): string;

export function phaseSessionContinueUrl(agent: string, sessionId: string, env?: Record<string, string | undefined>): string;

export function phaseSessionStreamUrl(agent: string, sessionId: string, env?: Record<string, string | undefined>): string;

export function startPhaseAgent(input: {
  agent: string;
  message: string;
  actor?: { userId: string; teamId?: string | null; channelId?: string | null; threadTs?: string | null } | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  auth?: Record<string, string>;
}): Promise<{
  agent: string;
  sessionId: string;
  deliveryId: string | null;
  tool: string;
  url: string;
}>;

export function continuePhaseSession(input: {
  agent: string;
  sessionId: string;
  message?: string;
  answers?: readonly { interactionId: string; optionId: string }[];
  actor?: { userId: string; teamId?: string | null; channelId?: string | null; threadTs?: string | null } | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  auth?: Record<string, string>;
}): Promise<{
  agent: string;
  sessionId: string;
  deliveryId: string | null;
  tool: string;
  url: string;
}>;

export function readPhaseReply(input: {
  agent: string;
  sessionId: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  auth?: Record<string, string>;
}): Promise<{
  reply: string;
  question: { interactionId: string; prompt: string; options: { id: string; label: string }[] } | null;
}>;

export function answerPhaseSession(input: {
  agent: string;
  sessionId: string;
  interactionId: string;
  optionId: string;
  actor?: { userId: string; teamId?: string | null; channelId?: string | null; threadTs?: string | null } | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  auth?: Record<string, string>;
}): Promise<{
  agent: string;
  sessionId: string;
  deliveryId: string | null;
  tool: string;
  url: string;
}>;
