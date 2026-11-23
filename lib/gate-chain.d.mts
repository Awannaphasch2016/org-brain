export const TRANSITION_KIND: string;
export const RECORDING_POINTER_KIND: string;
export const PHASE_SESSION_KIND: string;
export function nextPhaseFor(stage: string): "tor" | "project-planner" | "specification" | null | undefined;
export function rememberPhaseSession(
  client: { request: Function; owner: string; repo: string },
  pullNumber: number,
  record: { idempotencyKey?: string; projectId?: string; agent?: string; sessionId?: string; pr?: number },
): Promise<{ agent?: string; sessionId?: string } | null>;
export function stampForDecision(decision: { decidedAt?: string }): string;
export function renderTransition(event: Record<string, unknown>): string;
export function recordingAlreadyOpened(client: { request: Function; owner: string; repo: string }, pullNumber: number): Promise<boolean>;
export function deferGateChain(waitUntil: (work: Promise<void>) => void, start: () => Promise<unknown>): Promise<void>;
export function runApprovedGateChain(input: Record<string, any>): Promise<Record<string, any>>;
