export function srsCoverage(srs: string, torText: string): { covered: number; total: number };
export function renderSrsGateNote(input: {
  srs: string;
  torText: string;
  validationOk: boolean;
  url?: string;
}): string;
export function renderSrsGateCard(input: {
  projectId: string;
  repo: string;
  pr: number;
  headSha: string;
  note: string;
}): Record<string, any>;
export function postSrsGateCard(slack: { channelId: string; threadTs?: string; request: Function }, card: { text: string; blocks?: readonly Record<string, unknown>[] }): Promise<void>;
