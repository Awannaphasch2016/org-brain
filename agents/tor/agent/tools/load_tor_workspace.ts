import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { loadProjectFiles } from "../../../../lib/project-files.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Load a project's files from the default branch, or from a tor/ pull request head when revising. Does not treat an old-format project as loadable.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    ref: z.string().min(1).optional(),
  }),
  async execute({ projectId, ref }, ctx) {
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
    const loaded = await loadProjectFiles(client, {
      projectId,
      ref: ref ?? repository.default_branch,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (loaded.denied || loaded.stop) {
      return { denied: loaded.denied, fetch: false, stop: true, reason: loaded.reason };
    }
    const sandbox = await ctx.getSandbox();
    for (const [path, content] of Object.entries(loaded.files ?? {})) {
      await sandbox.writeTextFile({ path, content });
    }
    return { denied: false, fetch: true, stop: false, ref: loaded.sha };
  },
});
