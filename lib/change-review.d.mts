export function validateChangeReview(input: {
  review?: string;
  originalSrs?: string;
  revisedSrs?: string;
  originalTraceability?: string;
  revisedTraceability?: string;
  torText?: string;
  expectedTorSha256?: string;
}): { ok: boolean; errors: string[]; warnings: string[]; report: string };

export function changeReviewValidationInput(input: {
  loaded?: {
    srsText?: string;
    torText?: string;
    torSha256?: string;
    traceabilityText?: string;
  };
  review?: string;
  revisedSrs?: string;
  revisedTraceability?: string | null;
}): {
  review: string;
  originalSrs: string;
  revisedSrs: string;
  originalTraceability: string;
  revisedTraceability: string;
  torText: string;
  expectedTorSha256: string;
};

export function changePullRequestFiles(input: {
  projectId: string;
  review: string;
  revisedSrs: string;
  revisedTraceability?: string | null;
  report: string;
}): Array<{ path: string; content: string }>;

export function changePullRequestCard(input: {
  projectId: string;
  repo: string;
  pr: number;
  headSha: string;
}): { text: string; blocks: Array<Record<string, any>> };
