import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { loadChangeControlSources } from "../../../../lib/project-files.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Load project.yaml, docs/tor.md, and docs/srs.md at their approved baseline commits. Stops when the TOR format is retired or a baseline hash does not match. Does not merge.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async execute({ projectId }, ctx) {
    const client = await githubClientFromContext(ctx);
    const loaded = await loadChangeControlSources(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (loaded.denied || loaded.stop || !loaded.projectYaml || !loaded.torText || !loaded.srsText) {
      return { denied: loaded.denied, fetch: false, stop: true, projectId, reason: loaded.reason };
    }
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({ path: `projects/${projectId}/project.yaml`, content: loaded.projectYaml });
    await sandbox.writeTextFile({ path: loaded.torPath ?? `projects/${projectId}/docs/tor.md`, content: loaded.torText });
    await sandbox.writeTextFile({ path: loaded.srsPath ?? `projects/${projectId}/docs/srs.md`, content: loaded.srsText });
    return {
      denied: false,
      fetch: true,
      stop: false,
      projectId,
      torSha256: loaded.torSha256,
      torMergeCommit: loaded.torMergeCommit,
      srsSha256: loaded.srsSha256,
      srsMergeCommit: loaded.srsMergeCommit,
    };
  },
});
