import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPullRequestStatus } from "../../../../lib/github.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description: "Read pull request review state and merge commit. Does not merge.",
  inputSchema: z.object({ pullNumber: z.number().int().positive() }),
  async execute({ pullNumber }, ctx) {
    const client = await githubClientFromContext(ctx);
    return getPullRequestStatus(client, pullNumber);
  },
});