export const PHASE_AGENT_TOOL: Record<string, string>;

export function phaseAgentSessionUrl(agent: string, env?: Record<string, string | undefined>): string;

export function phaseTaskMessage(input: {
  agent: string;
  projectId?: string;
  text?: string;
  threadTs?: string;
}): string;

export function startPhaseAgent(input: {
  agent: string;
  message: string;
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
