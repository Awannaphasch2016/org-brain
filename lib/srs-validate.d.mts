export function sha256(text: string): string;
export function listRequirementIds(markdown: string): string[];
export function isTorPath(filePath: string): boolean;
export function assessSrsGate(input: {
  project: Record<string, any> | null | undefined;
  torText?: string;
}): { ok: boolean; reason?: string; sha256?: string; mergeCommit?: string };

export function validateSrs(input: {
  srs?: string;
  torText?: string;
  expectedTorSha256?: string;
  elicitationLog?: string;
  analysis?: string;
  changedPaths?: readonly string[];
}): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  report: string;
  torSha256: string;
};
