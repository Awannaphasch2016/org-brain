export function projectIdFromSlackText(text: string | undefined): string | null;

export function loadOrchestratorProject(
  client: { request: Function; owner: string; repo: string },
  projectId: string,
): Promise<Record<string, any> | null>;

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
