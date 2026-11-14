import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { loadApprovedSrs } from "../../../../lib/project-files.mjs";
import { resolveStageInput } from "../../../../lib/stage-gate.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Authorize the Slack user and load an approved SRS at its baseline commit, or acknowledge a fixture without treating it as a baseline. A hash mismatch stops the load.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixtureId: z.string().optional(),
  }),
  async execute({ projectId, fixtureId }, ctx) {
    if (fixtureId) {
      const input = resolveStageInput({ fixtureId, previousBaselineApproved: false });
      return {
        denied: false,
        fetch: false,
        fixture: true,
        recordBaseline: input.recordBaseline,
        root: input.root,
      };
    }
    const client = await githubClientFromContext(ctx);
    const loaded = await loadApprovedSrs(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (loaded.denied || loaded.stop || !loaded.projectYaml || !loaded.documentText || !loaded.documentPath) {
      return {
        denied: loaded.denied,
        fetch: false,
        stop: true,
        fixture: false,
        recordBaseline: false,
        reason: loaded.reason,
      };
    }
    const sandbox = await ctx.getSandbox();
    const yamlPath = `projects/${projectId}/project.yaml`;
    await sandbox.writeTextFile({ path: yamlPath, content: loaded.projectYaml });
    await sandbox.writeTextFile({ path: loaded.documentPath, content: loaded.documentText });
    return {
      denied: false,
      fetch: true,
      stop: false,
      fixture: false,
      recordBaseline: true,
      srsSha256: loaded.sha256,
      srsBaseline: loaded.mergeCommit,
    };
  },
});
