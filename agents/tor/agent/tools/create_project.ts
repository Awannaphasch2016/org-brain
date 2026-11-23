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
    "Open a setup pull request from a Slack upload or from pasted message text. A file is read from /workspace/.eve/attachments. Pasted text is saved unchanged. Never merges.",
  inputSchema: z.object({
    projectId: z.string(),
    title: z.string().min(1),
    attachmentPath: z.string().min(1).optional(),
    text: z.string().optional(),
    slackChannelId: z.string().min(1).optional(),
    slackMessageTs: z.string().min(1).optional(),
  }),
  approval: always(),
  async execute(input, ctx) {
    const pasted = input.text != null;
    if (pasted === Boolean(input.attachmentPath)) {
      throw new Error("provide a Slack upload or pasted message text, not both");
    }
    const userId = slackUserIdFromAuth(ctx.session.auth.current);
    const uploadedBy = uploadedByFromAuth(ctx.session.auth.current, userId);
    if (!uploadedBy) throw new Error("uploader is not the signed-in Slack user");
    const client = await githubClientFromContext(ctx);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    if (pasted) {
      return createProjectSetup(client, {
        projectId: input.projectId,
        title: input.title,
        source: "slack-message",
        text: input.text,
        slackChannelId: input.slackChannelId,
        slackMessageTs: input.slackMessageTs,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        userId,
        allowedUserIds: factoryConfig.allowedUserIds,
        stamp,
      });
    }
    const attachmentPath = input.attachmentPath;
    if (!attachmentPath) throw new Error("Slack upload path is missing");
    const sandbox = await ctx.getSandbox();
    const bytes = await sandbox.readBinaryFile({ path: attachmentPath });
    if (!bytes) throw new Error("Slack upload was not found in the attachment store");
    const upload = loadSlackUpload({ attachmentPath, bytes });
    if (!upload.ok) throw new Error(upload.reason);
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
