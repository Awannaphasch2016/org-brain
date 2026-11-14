import { validateIntake } from "./intake-validate.mjs";
import { closePullRequest, openReviewedPullRequest, recordApprovedBaseline } from "./github.mjs";
import { issueTorWriteGrant } from "./tor-guard.mjs";
import { renderGateCard } from "./slack-gate.mjs";
import { readFile } from "node:fs/promises";

async function structureMarkdown() {
  return readFile(new URL("../knowledge/guidelines/tor-structure.md", import.meta.url), "utf8");
}

export async function openTorDraft(client, input) {
  const issued = input.grant ? { ok: true, grant: input.grant } : await issueTorWriteGrant(client, input.projectId);
  if (!issued.ok) throw new Error(issued.reason);
  const validation = validateIntake({
    tor: input.tor,
    analysis: input.analysis,
    elicitationLog: input.elicitationLog,
    structureMarkdown: input.structureMarkdown ?? (await structureMarkdown()),
  });
  if (!validation.ok) {
    throw new Error(`Refusing to open a TOR pull request while intake fails: ${validation.errors.join("; ")}`);
  }
  if (input.supersededPullNumber) {
    await closePullRequest(client, input.supersededPullNumber);
  }
  const prefix = `projects/${input.projectId}/docs/`;
  const opened = await openReviewedPullRequest(client, {
    projectId: input.projectId,
    baseBranch: input.baseBranch,
    branch: `tor/${input.projectId}/${input.stamp}`,
    title: input.title || `TOR for ${input.projectId}`,
    messagePrefix: "Draft TOR",
    torGrant: issued.grant,
    files: [
      { path: `${prefix}tor.md`, content: input.tor },
      { path: `${prefix}tor-analysis.md`, content: input.analysis },
      { path: `${prefix}tor-elicitation-log.md`, content: input.elicitationLog },
    ],
    body: `TOR draft for \`${input.projectId}\`. This pull request does not merge itself.`,
  });
  const card = renderGateCard({
    projectId: input.projectId,
    stage: "tor",
    repo: `${client.owner}/${client.repo}`,
    pr: opened.number,
    headSha: opened.headSha,
    humanCommits: input.humanCommits ?? [],
  });
  return { ...opened, card, supersededPullNumber: input.supersededPullNumber ?? null, merged: false };
}

export async function recordTorBaseline(client, input) {
  return recordApprovedBaseline(client, { ...input, block: "tor" });
}
