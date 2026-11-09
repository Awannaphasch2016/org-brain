export function validateChangeReview(input: {
  review?: string;
  originalSrs?: string;
  revisedSrs?: string;
  torText?: string;
  expectedTorSha256?: string;
}): { ok: boolean; errors: string[]; warnings: string[]; report: string };
