import { REQUIRED_SECTIONS } from "./srs-validate.mjs";
import { renderGateCard } from "./slack-gate.mjs";

function sectionPresent(srs, title) {
  const pattern = new RegExp(`^#{1,3} ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  return pattern.test(String(srs ?? ""));
}

function citedIsIds(srs) {
  const cited = new Set();
  const blocks = [...String(srs ?? "").matchAll(/^#{2,4} ((?:FR|NFR)-\d{3})\b.*$/gm)];
  blocks.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = blocks[index + 1]?.index ?? String(srs).length;
    const body = String(srs).slice(start, end);
    const source = body.match(/^\s*(?:[-*]\s+)?(?:\*\*)?Source(?:\*\*)?\s*:\s*(.+)$/im)?.[1] ?? "";
    for (const id of source.match(/\bIS-\d{3}\b/g) ?? []) cited.add(id);
  });
  return cited;
}

export function srsCoverage(srs, torText) {
  const torIds = [...new Set([...String(torText ?? "").matchAll(/\b(IS-\d{3})\b/g)].map((match) => match[1]))];
  const cited = citedIsIds(srs);
  const covered = torIds.filter((id) => cited.has(id)).length;
  return { covered, total: torIds.length };
}

export function renderSrsGateNote({ srs, torText, validationOk, url }) {
  const coverage = srsCoverage(srs, torText);
  const sections = REQUIRED_SECTIONS.map((title) => `${title}: ${sectionPresent(srs, title) ? "present" : "missing"}`);
  return [
    ...sections,
    `Validation: ${validationOk ? "pass" : "fail"}`,
    `IS coverage: ${coverage.covered}/${coverage.total}`,
    String(url ?? ""),
  ].join("\n");
}

export function renderSrsGateCard({ projectId, repo, pr, headSha, note }) {
  return renderGateCard({ projectId, stage: "srs", repo, pr, headSha, note });
}

export async function postSrsGateCard(slack, card) {
  const body = {
    channel: slack.channelId,
    text: card.text,
  };
  if (slack.threadTs) body.thread_ts = slack.threadTs;
  if (card.blocks?.length) body.blocks = card.blocks;
  await slack.request("chat.postMessage", body);
}
