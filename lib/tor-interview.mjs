import { bundledTorContract, torContractFields, torSectionsFromGuideline, validateIntake } from "./intake-validate.mjs";

const FIELD_STATES = new Set(["missing", "draft", "clarified", "confirmed"]);

function statuses(analysis) {
  const found = new Map();
  for (const line of String(analysis ?? "").split(/\r?\n/)) {
    const match = line.match(/\b(\d+\.\d+)\b[^|\n]*\|\s*(missing|draft|clarified|confirmed)\b/i)
      ?? line.match(/\|\s*(6)\s+References\s*\|\s*(missing|draft|clarified|confirmed)\b/i);
    if (!match || !FIELD_STATES.has(match[2].toLowerCase())) continue;
    found.set(match[1], match[2].toLowerCase());
  }
  return found;
}

function contractState(analysis, field) {
  const name = field.name.toLowerCase();
  const label = field.label.toLowerCase();
  for (const line of String(analysis ?? "").split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim().toLowerCase());
    if (!cells.includes(name) && !cells.includes(label)) continue;
    const state = cells.find((cell) => FIELD_STATES.has(cell));
    if (state) return state;
  }
  return "missing";
}

export function nextInterviewQuestions({
  analysis = "",
  contract = bundledTorContract(),
  structureMarkdown = "",
} = {}) {
  const questions = [];
  for (const field of torContractFields(contract).required) {
    const state = contractState(analysis, field);
    if (state !== "confirmed") questions.push({ kind: "field", id: field.name, state });
  }
  for (const section of torSectionsFromGuideline(structureMarkdown).required) {
    const state = statuses(analysis).get(section.id) ?? "missing";
    if (state !== "confirmed") questions.push({ kind: "section", id: section.id, title: section.title, state });
  }
  return questions;
}

function telCount(elicitationLog) {
  return (String(elicitationLog ?? "").match(/^## TEL-\d{3}\b/gm) ?? []).length;
}

export function planTorInterview({
  analysis = "",
  tor = "",
  elicitationLog = "",
  contract = bundledTorContract(),
  structureMarkdown = "",
} = {}) {
  const questions = nextInterviewQuestions({ analysis, contract, structureMarkdown });
  if (questions.length > 0) {
    return {
      ask: true,
      questions,
      tools: ["ask_question"],
      createTorPullRequest: false,
    };
  }
  const validation = validateIntake({ tor, analysis, elicitationLog, structureMarkdown, contractMarkdown: contract });
  const required = questions.length
    + torContractFields(contract).required.length
    + torSectionsFromGuideline(structureMarkdown).required.length;
  if (!validation.ok || telCount(elicitationLog) < required) {
    return {
      ask: false,
      questions: [],
      tools: ["validate_intake"],
      createTorPullRequest: false,
      validation,
    };
  }
  return {
    ask: false,
    questions: [],
    tools: ["validate_intake", "create_tor_pull_request"],
    createTorPullRequest: true,
    validation,
  };
}

export function planSetupFollowUp(result) {
  if (!result || result.status !== "approved" || result.decision?.stage !== "setup") return null;
  const decision = result.decision;
  return {
    projectId: decision.projectId,
    pr: decision.pr,
    headSha: decision.headSha,
    idempotencyKey: decision.idempotencyKey,
    firstTool: "load_tor_workspace",
    prompt: [
      `Setup pull request #${decision.pr} is approved.`,
      `Merge head: ${decision.headSha}.`,
      "Call load_tor_workspace first, then interview any field that is missing or draft.",
      "Do not wait for another Slack message.",
    ].join(" "),
  };
}

export function maybeStartTorAfterGate(agent, result, started = new Set()) {
  if (agent !== "tor") return null;
  const plan = planSetupFollowUp(result);
  if (!plan || started.has(plan.idempotencyKey)) return null;
  started.add(plan.idempotencyKey);
  return plan;
}
