import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { gateApproverIds } from "../../../../lib/gate-actions.mjs";
import { recordApprovedBaseline } from "../../../../lib/github.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "After a person merges a change pull request, open a follow-up pull request recording that merge as the SRS baseline. approvedAt and approvedBy come from the verified decision. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
    fixture: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, pullNumber, fixture }, ctx) {
    if (fixture) throw new Error("Refusing to record a baseline from a fixture.");
    const client = await githubClientFromContext(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return recordApprovedBaseline(client, {
      projectId,
      pullNumber,
      block: "srs",
      stamp,
      allowedUserIds: gateApproverIds(),
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
  },
});
