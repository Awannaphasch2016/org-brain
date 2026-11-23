export function projectIdFromSlackText(text: string | undefined): string | null;

export function loadOrchestratorProject(
  client: { request: Function; owner: string; repo: string },
  projectId: string,
): Promise<Record<string, any> | null>;

export function projectIdFromThread(messages: readonly { text?: string; body?: string }[] | undefined): string | null;

export function phaseSessionFromThread(messages: readonly { text?: string; body?: string }[] | undefined): Record<string, any> | null;

export function deliverAnsweredPhase(input: {
  answer: { agent: string; sessionId: string; interactionId: string; optionId: string };
  actor?: { userId: string; teamId?: string | null; channelId?: string | null; threadTs?: string | null } | null;
  threadTs?: string | null;
  post: (payload: { text: string; blocks?: Record<string, any>[]; threadTs?: string | null }) => Promise<unknown> | unknown;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  auth?: Record<string, string>;
}): Promise<{ reply: string; question: { interactionId: string; prompt?: string; options?: { id: string; label?: string }[] } | null }>;

export function deliverPhaseOutput(input: {
  binding?: string | null;
  reply?: string | null;
  question?: { interactionId: string; prompt?: string; options?: readonly { id: string; label?: string }[] } | null;
  agent?: string | null;
  sessionId?: string | null;
  threadTs?: string | null;
  post: (payload: { text: string; blocks?: Record<string, any>[]; threadTs?: string | null }) => Promise<unknown> | unknown;
}): Promise<void>;

export function handleSpecificationInbound(input: {
  projectState: Record<string, any>;
  text?: string;
  threadMessages?: readonly { text?: string; body?: string }[];
  startAgent?: (input: { agent: string; message: string }) => Promise<{ agent: string; sessionId: string; tool: string }>;
  continueAgent?: (input: { agent: string; sessionId: string; message: string }) => Promise<{ agent: string; sessionId: string; tool: string }>;
  readReply?: (invoked: { agent: string; sessionId: string }) => Promise<string | { reply?: string | null; question?: { interactionId: string; prompt?: string; options?: readonly { id: string; label?: string }[] } | null }>;
  recordSession?: (record: { pr?: number; idempotencyKey?: string; projectId?: string; agent?: string; sessionId?: string }) => Promise<{ agent?: string; sessionId?: string } | null>;
  actor?: { userId: string; teamId?: string | null; channelId?: string | null; threadTs?: string | null } | null;
  requestUrl?: string;
}): Promise<{
  agent: string | null;
  advanced: boolean;
  requestUrl: string;
  invoked: { agent: string; sessionId: string; tool: string } | null;
  resumed?: boolean;
  reply?: string | null;
  question?: { interactionId: string; prompt?: string; options?: readonly { id: string; label?: string }[] } | null;
  binding?: string | null;
}>;

export function dispatchSpecificationInbound(input: {
  projectState: Record<string, any>;
  text?: string;
  requestUrl?: string;
}): {
  agent: string | null;
  prompt: string | null;
  advanced: boolean;
  requestUrl: string;
  bot: string;
};
