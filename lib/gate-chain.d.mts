export const TRANSITION_KIND: string;
export const RECORDING_POINTER_KIND: string;
export function nextPhaseFor(stage: string): "project-planner" | "specification" | null | undefined;
export function stampForDecision(decision: { decidedAt?: string }): string;
export function renderTransition(event: Record<string, unknown>): string;
export function runApprovedGateChain(input: Record<string, any>): Promise<Record<string, any>>;
