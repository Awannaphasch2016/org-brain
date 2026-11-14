export const DEFAULT_GATE_APPROVER_SLACK_ID: string;
export const GATE_ACTIONS: readonly string[];
export const ACTION_LABELS: { readonly approve: string; readonly reject: string; readonly revise: string };
export const RECORDING_STAGES: ReadonlySet<string>;
export function gateApproverIds(env?: NodeJS.ProcessEnv): string[];
export function gateDenyIds(env?: NodeJS.ProcessEnv): string[];
export function actionsForStage(stage: string, state: string): string[];
export function actionNeedsReason(action: string): boolean;
export function stageIsKnown(stage: string): boolean;
