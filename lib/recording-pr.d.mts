export const RECORDING_KIND: string;
export const RECORDING_DOCUMENTS: readonly string[];
export function renderRecordingReference(reference: Record<string, unknown>): string;
export function parseRecordingReference(body: string): {
  document: string;
  projectId: string;
  sourcePr: number;
  sourceHeadSha: string;
  sourceMergeSha: string;
  repo: string;
} | null;
export function changedYamlPaths(before: Record<string, any> | null, after: Record<string, any> | null, prefix?: string): string[];
export function recordingYamlIssue(text: string): string | null;
export function evaluateRecordingPullRequest(input: {
  files: readonly { path: string }[];
  reference: {
    document: string;
    projectId: string;
    sourcePr: number;
    sourceHeadSha: string;
    sourceMergeSha: string;
    repo: string;
    recordingPr?: number;
    recordingHeadSha?: string;
  } | null;
  approval: unknown;
  sourcePull: {
    repo: string;
    number: number;
    headSha: string;
    merged: boolean;
    mergeCommitSha: string | null;
  } | null;
  beforeYaml: Record<string, any> | null;
  afterYaml: Record<string, any> | null;
  beforeText?: string | null;
  afterText?: string | null;
}): {
  ok: boolean;
  reason: string;
  paths?: string[];
  authorization?: { kind: "recording"; repo: string; pr: number; headSha: string };
};
