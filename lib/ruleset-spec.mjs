import { sha256Hex, jcs } from "./owner-approval.mjs";

// <APP_ID> is the only unfilled value. It is not a guessed App id.
// cursor[bot] (app id 1210556) is not a candidate.
export const APP_ID_PLACEHOLDER = "<APP_ID>";

export const RULESET_TEMPLATES = [
  {
    name: "iso-approval-records-app-only",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/iso-approval-records"], exclude: [] } },
    rules: [{ type: "creation" }, { type: "deletion" }, { type: "update" }],
    bypass_actors: [{ actor_id: APP_ID_PLACEHOLDER, actor_type: "Integration", bypass_mode: "always" }],
  },
  {
    name: "iso-approval-records-history",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/iso-approval-records"], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "required_linear_history" }],
    bypass_actors: [],
  },
  {
    name: "iso-approval-executions-append-only",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/iso-approval-executions"], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "required_linear_history" }],
    bypass_actors: [],
  },
  {
    name: "iso-approval-requests-keep-history",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/iso-approval-requests"], exclude: [] } },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
    bypass_actors: [],
  },
];

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function projectRuleset(value) {
  const include = [...(value?.conditions?.ref_name?.include ?? [])].map(String).sort(compareText);
  const exclude = [...(value?.conditions?.ref_name?.exclude ?? [])].map(String).sort(compareText);
  const rules = (Array.isArray(value?.rules) ? value.rules : []).map((rule) => {
    const projected = { type: rule.type };
    if (rule.parameters && typeof rule.parameters === "object" && !Array.isArray(rule.parameters) && Object.keys(rule.parameters).length > 0) {
      projected.parameters = rule.parameters;
    }
    return projected;
  }).sort((left, right) => compareText(left.type, right.type));
  const bypass = (Array.isArray(value?.bypass_actors) ? value.bypass_actors : []).map((actor) => ({
    actor_id: actor.actor_id,
    actor_type: actor.actor_type,
    bypass_mode: actor.bypass_mode,
  })).sort((left, right) => {
    const type = compareText(String(left.actor_type), String(right.actor_type));
    if (type !== 0) return type;
    return compareText(String(left.actor_id), String(right.actor_id));
  });
  return {
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    conditions: { ref_name: { include, exclude } },
    rules,
    bypass_actors: bypass,
  };
}

export function rulesetSpecSha256(value) {
  return sha256Hex(jcs(projectRuleset(value)));
}

export function templateHashes() {
  return Object.fromEntries(RULESET_TEMPLATES.map((template) => [template.name, rulesetSpecSha256(template)]));
}

export function rulesetHashesMatch(liveRulesets) {
  if (!Array.isArray(liveRulesets)) return false;
  const hashes = new Set(liveRulesets.map((ruleset) => rulesetSpecSha256(ruleset)));
  return RULESET_TEMPLATES.every((template) => hashes.has(rulesetSpecSha256(template)));
}
