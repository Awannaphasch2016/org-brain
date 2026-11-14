import { defineTool } from "eve/tools";
import { z } from "zod";
import { getPullRequestStatus } from "../../../../lib/github.mjs";
import { githubClientFromContext } from "../lib/github-token.js";

export default defineTool({
  description:
    "Read a pull request's review state, requested changes, comments, merge state, and merge commit SHA. Does not merge.",
  inputSchema: z.object({
    pullNumber: z.number().int().positive(),
  }),
  async execute({ pullNumber }, ctx) {
    const client = await githubClientFromContext(ctx);
    return getPullRequestStatus(client, pullNumber);
  },
});
