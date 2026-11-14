import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { gateApproverIds } from "../../../../lib/gate-actions.mjs";
import { recordApprovedBaseline } from "../../../../lib/github.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "After the architecture pull request is merged, open a recording pull request for that baseline. approvedBy comes from the gate decision. Never merges and never records a fixture.",
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
    const opened = await recordApprovedBaseline(client, {
      projectId,
      block: "architecture",
      pullNumber,
      stamp,
      allowedUserIds: gateApproverIds(),
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
    return { ...opened, deployed: false };
  },
});
