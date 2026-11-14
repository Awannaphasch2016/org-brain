export const BASELINE_BLOCKS: readonly string[];

export function sha256Bytes(bytes: Uint8Array | string): string;

export function assessProjectFormat(project: Record<string, any> | null | undefined): {
  ok: boolean;
  reason?: string;
};

export function assessDocumentApproval(
  project: Record<string, any> | null | undefined,
  block: string,
): {
  ok: boolean;
  reason?: string;
  mergeCommit?: string;
  sha256?: string;
  path?: string;
};

export function readTorBaselineSha256(project: Record<string, any> | null | undefined): {
  ok: boolean;
  reason?: string;
  mergeCommit?: string;
  sha256?: string;
  path?: string;
};

export function recordBaseline(
  yaml: string,
  block: string,
  fields: {
    pullNumber: number;
    mergeCommit: string;
    approvedBy: string;
    approvedAt: string;
    extra?: Record<string, string | number | boolean | null>;
  },
): string;

export function markProjectRejected(yaml: string): string;
export function blockLabel(block: string): string;
export function recordingBranchName(block: string, projectId: string, stamp: string): string;
export function sourceBranchMatches(block: string, projectId: string, headRef: string | null | undefined): boolean;
