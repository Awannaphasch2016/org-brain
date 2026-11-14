export function markVerifiedDecision(decision: Record<string, unknown>): { decision: Record<string, unknown> };
export function readVerifiedDecision(
  wrapper: unknown,
): Record<string, unknown> | null;
export function sealMergeAuthorization(details: {
  kind: "gate" | "recording";
  repo: string;
  pr: number;
  headSha: string;
}): {
  kind: "gate" | "recording";
  repo: string;
  pr: number;
  headSha: string;
};
export function readMergeAuthorization(authorization: unknown): {
  kind: "gate" | "recording";
  repo: string;
  pr: number;
  headSha: string;
} | null;
