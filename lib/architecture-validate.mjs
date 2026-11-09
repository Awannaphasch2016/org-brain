import { listRequirementIds, sha256 } from "./srs-validate.mjs";

const SECTIONS = [
  "Introduction",
  "Constraints",
  "Components",
  "Interfaces",
  "Data",
  "Decisions and deferrals",
  "Traceability",
];

function sectionBody(markdown, title) {
  const pattern = new RegExp(`^# ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) return null;
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^# /m);
  return next === -1 ? rest : rest.slice(0, next);
}

export function validateArchitecture({ architecture = "", srs = "" }) {
  const errors = [];
  const warnings = [];
  for (const title of SECTIONS) {
    if (sectionBody(architecture, title) === null) errors.push(`missing required section: ${title}`);
  }
  const known = new Set(listRequirementIds(srs));
  if (known.size === 0) errors.push("the SRS has no functional or nonfunctional requirement ids");
  const components = [...architecture.matchAll(/^### (C-\d{3})\b.*$/gm)];
  if (components.length === 0) errors.push("architecture has no C-nnn components");
  const seen = new Set();
  for (let index = 0; index < components.length; index += 1) {
    const id = components[index][1];
    if (seen.has(id)) errors.push(`duplicate component id: ${id}`);
    seen.add(id);
    const start = components[index].index + components[index][0].length;
    const end = components[index + 1]?.index ?? architecture.length;
    const body = architecture.slice(start, end);
    const source = body.match(/^\s*(?:[-*]\s+)?Source:\s*(.+)$/im);
    if (!source) {
      errors.push(`${id} is missing a Source`);
    } else {
      const refs = source[1].match(/\b(?:FR|NFR)-\d{3}\b/g) ?? [];
      if (refs.length === 0) errors.push(`${id} Source must cite an FR or NFR id`);
      for (const ref of refs) {
        if (!known.has(ref)) errors.push(`${id} cites unknown requirement ${ref}`);
      }
    }
    if (/shall\s+(?:support|provide|allow)\s+external customer/i.test(body)) {
      errors.push(`${id} reintroduces external customer access`);
    }
  }
  const cited = architecture.match(/SRS baseline:\s*([a-f0-9]{64})/i);
  const actual = sha256(srs);
  if (!cited) errors.push("architecture is missing an SRS baseline sha256");
  else if (cited[1] !== actual) errors.push("SRS baseline hash does not match the supplied SRS");
  const ok = errors.length === 0;
  const report = [
    "# Architecture validation report",
    "",
    `Result: ${ok ? "pass" : "fail"}`,
    "",
    "## Errors",
    "",
    ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
  ].join("\n");
  return { ok, errors, warnings, report, srsSha256: actual };
}
