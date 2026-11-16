export function nextInterviewQuestions(input?: Record<string, unknown>): Array<Record<string, unknown>>;
export function planTorInterview(input?: Record<string, unknown>): Record<string, unknown>;
export function planSetupFollowUp(result: {
  status?: string;
  decision?: {
    stage?: string;
    projectId?: string;
    pr?: number;
    headSha?: string;
    idempotencyKey?: string;
  };
} | null): {
  projectId: string;
  pr: number;
  headSha: string;
  idempotencyKey: string;
  firstTool: string;
  prompt: string;
} | null;
export function maybeStartTorAfterGate(
  agent: string,
  result: {
    status?: string;
    decision?: {
      stage?: string;
      projectId?: string;
      pr?: number;
      headSha?: string;
      idempotencyKey?: string;
    };
  } | null,
  started?: Set<string>,
): {
  projectId: string;
  pr: number;
  headSha: string;
  idempotencyKey: string;
  firstTool: string;
  prompt: string;
} | null;
