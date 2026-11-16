import { sha256 } from "./srs-validate.mjs";
import { renderGateCard } from "./slack-gate.mjs";

const BLOCK = /^## (CR-\d{3})\s*$/gm;

function field(body, name) {
  const match = body.match(new RegExp(`^\\s*(?:[-*]\\s+)?${name}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function isIds(text) {
  return new Set([...String(text ?? "").matchAll(/\b(IS-\d{3})\b/g)].map((match) => match[1]));
}

function excludedScopeIds(text) {
  return [...new Set([...String(text ?? "").matchAll(/\b(OS-\d{3})\b/g)].map((match) => match[1]))];
}

function tableRows(traceability) {
  const rows = [];
  for (const line of String(traceability ?? "").split(/\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4 || /^requirement$/i.test(cells[0]) || /^-+$/.test(cells[0].replace(/ /g, ""))) continue;
    rows.push({ source: cells[1], status: cells[2].toLowerCase(), reason: cells[3] });
  }
  return rows;
}

function coveredIsIds(srs, traceability) {
  const ids = new Set();
  for (const line of String(srs ?? "").match(/^.*\bSource\b.*$/gim) ?? []) {
    for (const id of line.match(/\bIS-\d{3}\b/g) ?? []) ids.add(id);
  }
  for (const row of tableRows(traceability)) {
    if (row.status !== "covered") continue;
    for (const id of row.source.match(/\bIS-\d{3}\b/g) ?? []) ids.add(id);
  }
  return ids;
}

function coveredOrWaivedIsIds(srs, traceability) {
  const ids = coveredIsIds(srs, "");
  for (const row of tableRows(traceability)) {
    const mentioned = row.source.match(/\bIS-\d{3}\b/g) ?? [];
    if (row.status === "covered" || (row.status === "n/a" && row.reason.trim())) {
      for (const id of mentioned) ids.add(id);
    }
  }
  return ids;
}

export function validateChangeReview({
  review = "",
  originalSrs = "",
  revisedSrs = "",
  originalTraceability = "",
  revisedTraceability = "",
  torText = "",
  expectedTorSha256 = "",
}) {
  const errors = [];
  const matches = [...review.matchAll(BLOCK)];
  if (matches.length === 0) errors.push("no CR-nnn items were found");
  let accepted = false;
  for (let index = 0; index < matches.length; index += 1) {
    const id = matches[index][1];
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? review.length;
    const body = review.slice(start, end);
    const klass = (field(body, "Class") ?? "").toLowerCase();
    const disposition = (field(body, "Disposition") ?? "").toLowerCase();
    if (klass !== "elaboration" && klass !== "contradiction") {
      errors.push(`${id} class must be elaboration or contradiction`);
    }
    if (disposition !== "accept" && disposition !== "reject") {
      errors.push(`${id} disposition must be accept or reject`);
    }
    if (klass === "contradiction" && disposition === "accept") {
      errors.push(`${id} contradicts the frozen TOR and cannot be accepted`);
    }
    if (disposition === "accept") accepted = true;
  }
  if (sha256(torText) !== expectedTorSha256) {
    errors.push("TOR hash does not match the frozen baseline");
  }
  for (const id of excludedScopeIds(`${revisedSrs}\n${revisedTraceability}`)) {
    errors.push(`revised SRS adds excluded ${id}`);
  }
  if (accepted) {
    const before = coveredIsIds(originalSrs, originalTraceability);
    const after = coveredOrWaivedIsIds(revisedSrs, revisedTraceability);
    for (const id of before) {
      if (!after.has(id)) errors.push(`revised SRS drops ${id}`);
    }
    if (!revisedSrs.trim()) errors.push("an accepted change needs a revised SRS");
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings: [],
    report: ["# Change-review validation report", "", `Result: ${ok ? "pass" : "fail"}`, "", "## Errors", "", ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]), ""].join("\n"),
  };
}

export function changePullRequestCard(input) {
  return renderGateCard({
    projectId: input.projectId,
    stage: "srs",
    repo: input.repo,
    pr: input.pr,
    headSha: input.headSha,
    note: "Specification change. The frozen TOR is not modified.",
  });
}
