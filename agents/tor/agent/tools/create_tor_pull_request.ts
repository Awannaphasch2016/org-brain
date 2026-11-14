import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { issueTorWriteGrant } from "../../../../lib/tor-guard.mjs";
import { openTorDraft } from "../../../../lib/tor-draft.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

async function readOptional(
  sandbox: { readTextFile: (input: { path: string }) => PromiseLike<string | null> },
  path: string,
) {
  try {
    return (await sandbox.readTextFile({ path })) ?? "";
  } catch {
    return "";
  }
}

export default defineTool({
  description:
    "Open a stamped tor/<id>/<stamp> pull request for the TOR, analysis, and elicitation log. A revision closes the superseded pull request. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().optional(),
    supersededPullNumber: z.number().int().positive().optional(),
  }),
  approval: always(),
  async execute({ projectId, title, supersededPullNumber }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}/docs`;
    const client = await githubClientFromContext(ctx);
    const issued = await issueTorWriteGrant(client, projectId);
    if (!issued.ok) throw new Error(issued.reason);
    const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openTorDraft(client, {
      projectId,
      title,
      stamp,
      grant: issued.grant,
      baseBranch: repository.default_branch,
      supersededPullNumber,
      tor: await readOptional(sandbox, `${root}/tor.md`),
      analysis: await readOptional(sandbox, `${root}/tor-analysis.md`),
      elicitationLog: await readOptional(sandbox, `${root}/tor-elicitation-log.md`),
    });
  },
});
