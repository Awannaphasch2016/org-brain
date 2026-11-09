export function resolveStageInput(input: {
  fixtureId?: string | null;
  previousBaselineApproved: boolean;
}): {
  kind: "fixture" | "project";
  root?: string;
  denied?: boolean;
  recordBaseline: boolean;
  openPullRequest: boolean;
  reason?: string;
};

export function planStagePullRequest(input: {
  fixture: boolean;
  validationOk: boolean;
  projectId: string;
  files: readonly { path: string }[];
  allowedDocs: readonly string[];
}): { ok: true; paths: string[] } | { ok: false; error: string };
