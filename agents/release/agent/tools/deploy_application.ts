import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { deployApplication } from "../../../../lib/release.mjs";

export default defineTool({
  description:
    "Require human approval, then refuse to deploy. No hosting request is sent. Task Tracker Lite is not deployed.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  approval: always(),
  async execute() {
    return deployApplication({ approved: true });
  },
});