export function sha256(text: string): string;
export function listRequirementIds(markdown: string): string[];
export function isTorPath(filePath: string): boolean;
export function assessPhase3Gate(input: {
  project: Record<string, any> | null | undefined;
  torText?: string;
  planPaused?: boolean;
  routeApproval?: {
    client: {
      owner: string;
      repo: string;
      identity: { kind: string; botLogin: string; label?: string } | null;
      request(method: string, apiPath: string, init?: { body?: unknown; allowNotFound?: boolean }): Promise<any>;
    };
    action: {
      requestId: string;
      key: string;
      kind: string;
      title: string;
      statement: string;
      target: unknown;
    };
  };
}): Promise<{
  ok: boolean;
  reason?: string;
  sha256?: string;
  mergeCommit?: string;
  sourcePlanCommit?: string | null;
  sourcePlanSha256?: string | null;
  planCheckSkipped?: boolean;
}>;

export function assessRouteSkip(input: {
  project?: Record<string, any> | null;
  routeApproval?: {
    client?: { request?: (...args: any[]) => Promise<any> };
    action?: {
      requestId?: string;
      key?: string;
      kind?: string;
      title?: string;
      statement?: string;
      target?: unknown;
    };
  };
}): Promise<{ ok: true } | { ok: false; reason: string }>;

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
  traceability?: string;
  changedPaths?: readonly string[];
}): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  report: string;
  torSha256: string;
};
