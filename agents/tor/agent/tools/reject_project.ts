import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { gateApproverIds } from "../../../../lib/gate-actions.mjs";
import { closeSetupProject, openRejectedStatusPullRequest } from "../../../../lib/project-setup.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Close an unmerged setup pull request, or open a project.yaml pull request that sets status: rejected when a gate reject decision exists. Never merges.",
  inputSchema: z.object({
    projectId: z.string(),
    pullNumber: z.number().int().positive(),
    setup: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, pullNumber, setup }, ctx) {
    const client = await githubClientFromContext(ctx);
    if (setup) return closeSetupProject(client, { projectId, pullNumber });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openRejectedStatusPullRequest(client, {
      projectId,
      pullNumber,
      stamp,
      allowedUserIds: gateApproverIds(),
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
  },
});
