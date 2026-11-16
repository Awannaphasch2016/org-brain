export function validateChangeReview(input: {
  review?: string;
  originalSrs?: string;
  revisedSrs?: string;
  originalTraceability?: string;
  revisedTraceability?: string;
  torText?: string;
  expectedTorSha256?: string;
}): { ok: boolean; errors: string[]; warnings: string[]; report: string };

export function changePullRequestCard(input: {
  projectId: string;
  repo: string;
  pr: number;
  headSha: string;
}): { text: string; blocks: Array<Record<string, any>> };
