import { defineTool } from "eve/tools";
import { z } from "zod";
import { gateApproverIds } from "../../../../lib/gate-actions.mjs";
import { recordProjectPlanBaseline } from "../../../../lib/plan-draft.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Manual fallback after Gate 2. Open a plan recording pull request only when the gate chain has not already recorded one. Never asks the model for the hash.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
  }),
  async execute({ projectId, pullNumber }, ctx) {
    const client = await githubClientFromContext(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return recordProjectPlanBaseline(client, {
      projectId,
      pullNumber,
      stamp,
      allowedUserIds: gateApproverIds(),
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
  },
});
