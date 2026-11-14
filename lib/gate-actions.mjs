export const DEFAULT_GATE_APPROVER_SLACK_ID = "U0CFRUV378D";

export const GATE_ACTIONS = ["approve", "reject", "revise"];

export const ACTION_LABELS = {
  approve: "Approve",
  reject: "Reject",
  revise: "Request revision",
};

const HUMAN_GATE_ACTIONS = {
  setup: ["approve", "reject"],
  tor: ["approve", "reject", "revise"],
  srs: ["approve", "reject", "revise"],
  architecture: ["approve", "reject", "revise"],
  "tor-baseline": [],
  "srs-baseline": [],
  "architecture-baseline": [],
};

const INFO_STAGES = new Set(["approved", "rejected", "hash-mismatch"]);

export const RECORDING_STAGES = new Set(["tor-baseline", "srs-baseline", "architecture-baseline"]);

export function gateApproverIds(env = process.env) {
  const raw = env.FACTORY_GATE_APPROVER_IDS;
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [DEFAULT_GATE_APPROVER_SLACK_ID];
}

export function gateDenyIds(env = process.env) {
  const raw = env.FACTORY_GATE_DENY_SLACK_IDS;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export function actionsForStage(stage, state) {
  if (state !== "open") return [];
  if (INFO_STAGES.has(stage)) return [];
  return HUMAN_GATE_ACTIONS[stage] ? [...HUMAN_GATE_ACTIONS[stage]] : [];
}

export function actionNeedsReason(action) {
  return action === "reject" || action === "revise";
}

export function stageIsKnown(stage) {
  return Object.prototype.hasOwnProperty.call(HUMAN_GATE_ACTIONS, stage) || INFO_STAGES.has(stage);
}
