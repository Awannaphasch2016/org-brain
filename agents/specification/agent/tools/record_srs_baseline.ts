import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { gateApproverIds } from "../../../../lib/gate-actions.mjs";
import { recordApprovedBaseline } from "../../../../lib/github.mjs";
import { githubClientFromContext } from "../lib/github-token.js";

export default defineTool({
  description:
    "After the SRS pull request is merged, open a recording pull request for the SRS baseline. approvedBy comes from the gate decision, not from the caller. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
  }),
  approval: always(),
  async execute({ projectId, pullNumber }, ctx) {
    const client = await githubClientFromContext(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await recordApprovedBaseline(client, {
      projectId,
      block: "srs",
      pullNumber,
      stamp,
      allowedUserIds: gateApproverIds(),
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
    return {
      ...opened,
      note: "Recording pull request opened. It records the approved SRS decision and does not ask for a second approval.",
    };
  },
});
