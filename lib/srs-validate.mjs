import { createHash } from "node:crypto";
import { readTorBaselineSha256 } from "./baseline.mjs";
import { isNotionPageId, ROUTE_STEP_IDS, verifyApproval } from "./owner-approval.mjs";
import { PLAN_CHECK_SKIP_FOR_APPROVED_ROUTE } from "./plan-check-skip.mjs";
import { reintroducesOs } from "./scope-ids.mjs";

export const REQUIRED_SECTIONS = [
  "Introduction",
  "Scope",
  "Functional Requirements",
  "Nonfunctional Requirements",
  "Acceptance Criteria",
  "Constraints and References",
];

const ID_HEADING = /^#{2,4} ((?:FR|NFR|AC)-\d{3})\b.*$/gm;

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isTorPath(filePath) {
  return /(?:^|\/)docs\/tor\.md$/.test(String(filePath).replace(/\\/g, "/"));
}

function sectionBody(markdown, title) {
  const pattern = new RegExp(
    `^#{1,3} ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im",
  );
  const match = pattern.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^#{1,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

export function listRequirementIds(markdown) {
  return blocksById(markdown)
    .map((block) => block.id)
    .filter((id) => /^(?:FR|NFR)-/.test(id));
}

function blocksById(markdown) {
  const matches = [...markdown.matchAll(ID_HEADING)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    return { id: match[1], body: markdown.slice(start, end) };
  });
}

function field(body, name) {
  const match = body.match(
    new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${name}(?:\\*\\*)?\\s*:\\s*(.+)$`, "im"),
  );
  return match ? match[1].trim() : null;
}

export function parseGapRegister(analysis, { prefix = "G" } = {}) {
  if (!analysis) return [];
  const line = new RegExp(
    `^- (${prefix}-\\d+) \\| (blocking|nonblocking) \\| (unresolved|resolved) \\| (.+)$`,
    "gm",
  );
  return [...analysis.matchAll(line)].map((match) => ({
    id: match[1],
    blocking: match[2] === "blocking",
    resolved: match[3] === "resolved",
    summary: match[4].trim(),
  }));
}

export function parseElicitationItems(log, { prefix = "EL" } = {}) {
  if (!log) return [];
  const parts = log.split(new RegExp(`^## (${prefix}-\\d{3})\\s*$`, "m"));
  const items = [];
  for (let index = 1; index < parts.length; index += 2) {
    const body = parts[index + 1] ?? "";
    items.push({
      id: parts[index],
      className: field(body, "class"),
      resolution: field(body, "resolution"),
    });
  }
  return items;
}

function sourceIsIds(body) {
  return new Set((field(body, "Source") ?? "").match(/\bIS-\d{3}\b/g) ?? []);
}

function parseTraceability(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) continue;
    if (/^requirement$/i.test(cells[0]) || /^-+$/.test(cells[0].replace(/ /g, ""))) continue;
    rows.push({
      requirement: cells[0],
      source: cells[1],
      status: cells[2].toLowerCase(),
      reason: cells[3],
    });
  }
  return rows;
}

function traceabilityErrors(torText, traceability, blocks) {
  const errors = [];
  if (typeof traceability !== "string" || !traceability.trim()) {
    errors.push("docs/traceability.md is missing");
    return errors;
  }
  const rows = parseTraceability(traceability);
  const requirements = new Map(
    blocks.filter((block) => /^(FR|NFR)-/.test(block.id)).map((block) => [block.id, block]),
  );
  const covered = new Set();
  const waived = new Set();
  for (const row of rows) {
    if (row.status === "n/a") {
      const isId = (row.source.match(/\bIS-\d{3}\b/) ?? [])[0];
      if (!isId) continue;
      if (!row.reason.trim()) errors.push(`${isId} N/A has no reason`);
      else waived.add(isId);
      continue;
    }
    const requirement = requirements.get(row.requirement);
    if (!requirement) {
      errors.push(`row ${row.requirement} disagrees with srs.md`);
      continue;
    }
    const cited = new Set(row.source.match(/\bIS-\d{3}\b/g) ?? []);
    const expected = sourceIsIds(requirement.body);
    const same = cited.size === expected.size && [...cited].every((id) => expected.has(id));
    if (!same) errors.push(`row ${row.requirement} disagrees with srs.md`);
    else for (const id of cited) covered.add(id);
  }
  const torIds = [...new Set([...String(torText).matchAll(/\b(IS-\d{3})\b/g)].map((match) => match[1]))];
  for (const id of torIds) {
    if (!covered.has(id) && !waived.has(id)) errors.push(`${id} is neither covered nor N/A`);
  }
  return errors;
}

function parseGaps(analysis) {
  return parseGapRegister(analysis);
}

function parseElicitation(log) {
  return parseElicitationItems(log);
}

export function validateSrs({
  srs = "",
  torText = "",
  expectedTorSha256 = "",
  elicitationLog = "",
  analysis = "",
  changedPaths = [],
  traceability,
}) {
  const errors = [];
  const warnings = [];
  if (/^#{1,4} Traceability\s*$/m.test(String(srs ?? ""))) {
    errors.push("traceability belongs in docs/traceability.md");
  }

  for (const title of REQUIRED_SECTIONS) {
    if (sectionBody(srs, title) === null) {
      errors.push(`missing required section: ${title}`);
    }
  }

  const blocks = blocksById(srs);
  const seen = new Map();
  for (const block of blocks) {
    if (seen.has(block.id)) errors.push(`duplicate requirement id: ${block.id}`);
    seen.set(block.id, block);
  }

  const requirementIds = new Set(
    blocks.filter((block) => /^(FR|NFR)-/.test(block.id)).map((block) => block.id),
  );
  const torIsIds = new Set([...String(torText).matchAll(/\b(IS-\d{3})\b/g)].map((match) => match[1]));

  for (const block of blocks) {
    if (/^(FR|NFR)-/.test(block.id)) {
      const source = field(block.body, "Source") ?? "";
      const isIds = source.match(/\bIS-\d{3}\b/g) ?? [];
      const osIds = source.match(/\bOS-\d{3}\b/g) ?? [];
      if (!source) errors.push(`${block.id} is missing a Source`);
      else if (isIds.length === 0) errors.push(`${block.id} Source must cite an IS-nnn item`);
      if (osIds.length > 0) errors.push(`${block.id} Source cites excluded ${osIds.join(", ")}`);
      for (const isId of isIds) {
        if (!torIsIds.has(isId)) errors.push(`${block.id} cites unknown ${isId}`);
      }
    }
    if (block.id.startsWith("AC-")) {
      const verifies = field(block.body, "Verifies");
      if (!verifies) {
        errors.push(`${block.id} is missing a Verifies line`);
      } else {
        const refs = verifies.match(/\b(?:FR|NFR)-\d{3}\b/g) ?? [];
        if (refs.length === 0) errors.push(`${block.id} does not reference a requirement id`);
        for (const ref of refs) {
          if (!requirementIds.has(ref)) {
            errors.push(`${block.id} references unknown requirement ${ref}`);
          }
        }
      }
    }
  }

  for (const id of reintroducesOs(torText, srs)) {
    errors.push(`SRS reintroduces excluded ${id}`);
  }

  const actualHash = sha256(torText);
  if (!expectedTorSha256 || actualHash !== expectedTorSha256) {
    errors.push("TOR hash does not match the frozen baseline in project.yaml");
  }

  const torChanges = changedPaths.filter(isTorPath);
  if (torChanges.length > 0) {
    errors.push(`frozen TOR path would change: ${torChanges.join(", ")}`);
  }

  const gaps = parseGaps(analysis);
  if (!analysis.trim()) warnings.push("analysis file was not provided");
  else if (gaps.length === 0 && !/## Gap register/i.test(analysis)) {
    warnings.push("analysis has no Gap register");
  }
  for (const gap of gaps) {
    if (gap.blocking && !gap.resolved) {
      errors.push(`blocking gap remains unresolved: ${gap.id} ${gap.summary}`);
    }
  }

  errors.push(...traceabilityErrors(torText, traceability, blocks));

  for (const item of parseElicitation(elicitationLog)) {
    if (item.className === "conflict") {
      const resolution = (item.resolution ?? "").toLowerCase();
      if (resolution !== "rejected" && resolution !== "escalated") {
        errors.push(
          `${item.id} conflicts with the TOR and has no resolution (rejected or escalated)`,
        );
      }
    }
  }

  const ok = errors.length === 0;
  const report = [
    "# WP-SR-RS-01-VV SRS Validation Report",
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
    `TOR sha256: ${actualHash}`,
    "",
  ].join("\n");

  return { ok, errors, warnings, report, torSha256: actualHash };
}

export function assessSrsGate({ project, torText = "" }) {
  const baseline = readTorBaselineSha256(project);
  if (!baseline.ok) return baseline;
  if (sha256(torText) !== baseline.sha256) return { ok: false, reason: "tor-hash-mismatch" };
  return { ok: true, sha256: baseline.sha256, mergeCommit: baseline.mergeCommit };
}

export async function assessPhase3Gate({ project, torText = "", planPaused = false, routeApproval } = {}) {
  const torGate = assessSrsGate({ project, torText });
  if (!torGate.ok) return torGate;
  if (project?.srs?.status === "needs-review") return { ok: false, reason: "srs-needs-review" };
  if (planPaused) return { ok: false, reason: "projectPlan-paused" };
  const plan = project?.projectPlan;
  if (plan?.status === "approved" && typeof plan?.baseline?.mergeCommit === "string" && plan.baseline.mergeCommit) {
    return {
      ok: true,
      ...torGate,
      sourcePlanCommit: plan.baseline.mergeCommit,
      sourcePlanSha256: plan.baseline.sha256 ?? null,
    };
  }
  if (PLAN_CHECK_SKIP_FOR_APPROVED_ROUTE && (await assessRouteSkip({ project, routeApproval })).ok) {
    return {
      ok: true,
      ...torGate,
      sourcePlanCommit: null,
      sourcePlanSha256: null,
      planCheckSkipped: true,
    };
  }
  return { ok: false, reason: "projectPlan-not-approved" };
}

const ROUTE_STEP_ID_SET = new Set(ROUTE_STEP_IDS);

export async function assessRouteSkip({ project, routeApproval } = {}) {
  const action = routeApproval?.action;
  const client = routeApproval?.client;
  if (!action || action.kind !== "route-approval" || typeof client?.request !== "function") {
    return { ok: false, reason: "route-context-missing" };
  }
  const pageId = project?.notionPageId;
  if (!isNotionPageId(pageId)) return { ok: false, reason: "project-id-missing" };
  if (pageId !== action.target?.project?.id) return { ok: false, reason: "project-mismatch" };
  const steps = action.target?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, reason: "route-steps-invalid" };
  const seen = new Set();
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step) || typeof step.id !== "string") {
      return { ok: false, reason: "route-steps-invalid" };
    }
    if (!ROUTE_STEP_ID_SET.has(step.id) || seen.has(step.id)) return { ok: false, reason: "route-steps-invalid" };
    seen.add(step.id);
  }
  const srsAt = steps.findIndex((step) => step.id === "srs");
  const torAt = steps.findIndex((step) => step.id === "tor");
  if (srsAt < 0) return { ok: false, reason: "srs-missing" };
  if (torAt < 0) return { ok: false, reason: "tor-missing" };
  if (!(torAt < srsAt)) return { ok: false, reason: "tor-not-before-srs" };
  try {
    const verified = await verifyApproval({ client, action });
    if (verified?.ok !== true) return { ok: false, reason: "approval-not-verified" };
  } catch {
    return { ok: false, reason: "approval-not-verified" };
  }
  return { ok: true };
}
