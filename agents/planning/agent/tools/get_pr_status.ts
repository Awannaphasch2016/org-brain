import { defineTool } from "eve/tools";
import { z } from "zod";
import { GithubClient, getPullRequestStatus, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description: "Read pull request review state and merge commit. Does not merge.",
  inputSchema: z.object({ pullNumber: z.number().int().positive() }),
  async execute({ pullNumber }, ctx) {
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    return getPullRequestStatus(client, pullNumber);
  },
});