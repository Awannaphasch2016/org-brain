import { sha256Hex, jcs } from "./owner-approval.mjs";

// <APP_ID> is the only unfilled value. It is not a guessed App id.
// cursor[bot] (app id 1210556) is not a candidate.
// The hashes of these templates are the unfilled hashes: actor_id is the
// string "<APP_ID>". After B4 fills APP_ID, actor_id must be that JSON integer
// and the four spec hashes must be recomputed with filledRulesetTemplates.
// The unfilled hashes are not the live hashes.
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

export function filledRulesetTemplates(appId) {
  if (!Number.isInteger(appId)) return null;
  return RULESET_TEMPLATES.map((template) => ({
    ...template,
    conditions: { ref_name: { include: [...template.conditions.ref_name.include], exclude: [...template.conditions.ref_name.exclude] } },
    rules: template.rules.map((rule) => ({ type: rule.type })),
    bypass_actors: template.bypass_actors.map((actor) => ({ ...actor, actor_id: appId })),
  }));
}

export function branchRuleTypes(branch) {
  const include = `refs/heads/${branch}`;
  const types = new Set();
  for (const template of RULESET_TEMPLATES) {
    if (!template.conditions.ref_name.include.includes(include)) continue;
    for (const rule of template.rules) types.add(rule.type);
  }
  return [...types];
}

export function rulesetHashesMatch(liveRulesets, expected = RULESET_TEMPLATES) {
  if (!Array.isArray(liveRulesets) || !Array.isArray(expected)) return false;
  const hashes = new Set(liveRulesets.map((ruleset) => rulesetSpecSha256(ruleset)));
  return expected.every((template) => hashes.has(rulesetSpecSha256(template)));
}
