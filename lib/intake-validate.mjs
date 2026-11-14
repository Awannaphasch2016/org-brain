import { readFileSync } from "node:fs";
import { parseElicitationItems, parseGapRegister } from "./srs-validate.mjs";

const FIELD_STATES = new Set(["missing", "draft", "clarified", "confirmed"]);
const WORK_PRODUCTS = ["A2-01", "WP-PS-SOW-01", "WP-PS-PR-01"];

export function torSectionsFromGuideline(markdown) {
  const skeleton = String(markdown ?? "").split(/^## Rules\s*$/m)[0] ?? "";
  const required = [];
  for (const match of skeleton.matchAll(/\b(\d+\.\d+)\s+([^;\n]+?)(?=\s*;|\s*$)/gm)) {
    required.push({ id: match[1], title: match[2].trim() });
  }
  const optional = [...skeleton.matchAll(/^(\d+)\.\s+References\s*$/gm)].map((match) => ({
    id: match[1],
    title: "References",
  }));
  return { required, optional };
}

function sectionBody(markdown, id) {
  const pattern = new RegExp(`^#{1,4}\\s+${id.replace(".", "\\.")}\\b.*$`, "m");
  const match = pattern.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{1,4}\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function fieldStatuses(analysis) {
  const found = new Map();
  for (const line of String(analysis ?? "").split(/\r?\n/)) {
    const match = line.match(/\b(\d+\.\d+)\b[^|\n]*\|\s*(missing|draft|clarified|confirmed)\b/i);
    if (!match) continue;
    const state = match[2].toLowerCase();
    if (FIELD_STATES.has(state)) found.set(match[1], state);
  }
  return found;
}

function scopedIds(text, kind) {
  const wellFormed = new Set();
  const errors = [];
  for (const match of String(text ?? "").matchAll(new RegExp(`\\b(${kind}-\\d+)\\b`, "g"))) {
    const id = match[1];
    if (!new RegExp(`^${kind}-\\d{3}$`).test(id)) errors.push(`${id} is not well-formed`);
    else if (wellFormed.has(id)) errors.push(`duplicate ${kind} id: ${id}`);
    else wellFormed.add(id);
  }
  return { ids: [...wellFormed], errors };
}

const EMPTY_INTAKE_VALUE = /^(?:none|n\/a|na|tbd|not set|unknown|not identified|-)?$/i;

export function torContractFields(markdown) {
  const required = [];
  const optional = [];
  let bucket = null;
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    if (/^## Required\b/i.test(raw)) {
      bucket = required;
      continue;
    }
    if (/^## Optional\b/i.test(raw)) {
      bucket = optional;
      continue;
    }
    const match = raw.match(/^-\s+name:\s+(.+?)\s+\|\s+label:\s+([^|]+?)(?:\s+\|\s+min:\s+(\d+))?\s*$/i);
    if (!match || !bucket) continue;
    bucket.push({
      name: match[1].trim(),
      label: match[2].trim(),
      min: match[3] ? Number(match[3]) : 1,
    });
  }
  return { required, optional };
}

export function bundledTorContract() {
  return readFileSync(new URL("../knowledge/guidelines/tor-contract-fields.md", import.meta.url), "utf8");
}

function intakeValue(tor, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tor ?? "").match(new RegExp(`^\\s*(?:[-*]\\s+)?${escaped}\\s*:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : null;
}

function intakeCount(value) {
  if (value == null || EMPTY_INTAKE_VALUE.test(value)) return 0;
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part && !EMPTY_INTAKE_VALUE.test(part)).length;
}

export function missingIntakeFields(tor, contract) {
  const errors = [];
  for (const field of contract.required) {
    if (intakeCount(intakeValue(tor, field.label)) < field.min) {
      errors.push(`missing required intake field: ${field.name}`);
    }
  }
  return errors;
}

export function validateIntake({
  tor = "",
  analysis = "",
  elicitationLog = "",
  structureMarkdown = "",
  contractMarkdown = bundledTorContract(),
}) {
  const errors = [];
  const contract = torContractFields(contractMarkdown);
  errors.push(...missingIntakeFields(tor, contract));
  const sections = torSectionsFromGuideline(structureMarkdown);
  for (const section of sections.required) {
    if (sectionBody(tor, section.id) === null) {
      errors.push(`missing required section: ${section.id} ${section.title}`);
    }
  }
  const identification = sectionBody(tor, "1.1");
  if (identification && /approval status|status:\s*(approved|rejected|pending)/i.test(identification)) {
    errors.push("1.1 holds an approval status");
  }
  if (/none identified/i.test(tor)) errors.push("none identified is not an in-scope or out-of-scope item");
  const inScope = scopedIds(tor, "IS");
  const outScope = scopedIds(tor, "OS");
  errors.push(...inScope.errors, ...outScope.errors);
  if (inScope.ids.length === 0) errors.push("at least one IS-nnn is required");
  if (outScope.ids.length === 0) errors.push("at least one OS-nnn is required");

  for (const heading of ["Extraction", "Gap register", "Assumptions", "Risks", "Work products"]) {
    if (!new RegExp(`^## ${heading}\\s*$`, "im").test(analysis)) {
      errors.push(`tor-analysis is missing ${heading}`);
    }
  }
  const statuses = fieldStatuses(analysis);
  for (const section of sections.required) {
    const state = statuses.get(section.id);
    if (state !== "confirmed") {
      errors.push(`unconfirmed required field: ${section.id} ${section.title}`);
    }
  }
  for (const gap of parseGapRegister(analysis)) {
    if (gap.blocking && !gap.resolved) errors.push(`blocking unresolved gap: ${gap.id}`);
  }
  for (const product of WORK_PRODUCTS) {
    if (!analysis.includes(product)) errors.push(`work-product list is missing ${product}`);
  }

  if (/(^|\n)## EL-\d{3}\b/.test(elicitationLog)) {
    errors.push("EL ids are not valid in the TOR elicitation log");
  }
  const items = parseElicitationItems(elicitationLog, { prefix: "TEL" });
  if (items.length === 0) errors.push("TEL ids are required");
  for (const item of items) {
    const className = (item.className ?? "").toLowerCase();
    const resolution = (item.resolution ?? "").toLowerCase();
    if (className === "conflict" && resolution !== "rejected" && resolution !== "escalated") {
      errors.push(`${item.id} conflict must be rejected or escalated`);
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings: [],
    enforcedSections: sections.required.map((section) => `${section.id} ${section.title}`),
    report: [
      "# TOR intake report",
      "",
      `Result: ${ok ? "pass" : "fail"}`,
      "",
      "## Errors",
      "",
      ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]),
      "",
    ].join("\n"),
  };
}
