import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { createProjectSetup, loadSlackUpload } from "../../../../lib/project-setup.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

function uploadedByFromAuth(auth: { principalId?: string } | null | undefined, userId: string | null) {
  const principal = auth?.principalId;
  if (typeof principal === "string" && /^slack:[^:\s]+:[UW][A-Z0-9]+$/.test(principal)) return principal;
  if (!userId) return null;
  return `slack:session:${userId}`;
}

export default defineTool({
  description:
    "Open a setup pull request from the Slack file Eve stored under /workspace/.eve/attachments. The tool reads those bytes itself. Never merges.",
  inputSchema: z.object({
    projectId: z.string(),
    title: z.string().min(1),
    attachmentPath: z.string().min(1),
  }),
  approval: always(),
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    const bytes = await sandbox.readBinaryFile({ path: input.attachmentPath });
    if (!bytes) throw new Error("Slack upload was not found in the attachment store");
    const upload = loadSlackUpload({ attachmentPath: input.attachmentPath, bytes });
    if (!upload.ok) throw new Error(upload.reason);
    const userId = slackUserIdFromAuth(ctx.session.auth.current);
    const uploadedBy = uploadedByFromAuth(ctx.session.auth.current, userId);
    if (!uploadedBy) throw new Error("uploader is not the signed-in Slack user");
    const client = await githubClientFromContext(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return createProjectSetup(client, {
      projectId: input.projectId,
      title: input.title,
      filename: upload.filename,
      mediaType: upload.mediaType,
      bytes,
      slackFileId: upload.slackFileId,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      userId,
      allowedUserIds: factoryConfig.allowedUserIds,
      stamp,
    });
  },
});
