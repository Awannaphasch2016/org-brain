export function projectIdFromSlackText(text: string | undefined): string | null;

export function loadOrchestratorProject(
  client: { request: Function; owner: string; repo: string },
  projectId: string,
): Promise<Record<string, any> | null>;

export function projectIdFromThread(messages: readonly { text?: string; body?: string }[] | undefined): string | null;

export function handleSpecificationInbound(input: {
  projectState: Record<string, any>;
  text?: string;
  threadMessages?: readonly { text?: string; body?: string }[];
  startAgent?: (input: { agent: string; message: string }) => Promise<{ agent: string; sessionId: string; tool: string }>;
  requestUrl?: string;
}): Promise<{
  agent: string | null;
  advanced: boolean;
  requestUrl: string;
  invoked: { agent: string; sessionId: string; tool: string } | null;
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
