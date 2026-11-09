import { defineTool } from "eve/tools";
import { z } from "zod";
import { GithubClient, getPullRequestStatus, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { resolveGithubToken } from "../lib/github-token.js";

export default defineTool({
  description:
    "Read a pull request's review state, requested changes, comments, merge state, and merge commit SHA. Does not merge.",
  inputSchema: z.object({
    pullNumber: z.number().int().positive(),
  }),
  async execute({ pullNumber }, ctx) {
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({
      token: await resolveGithubToken(ctx),
      owner,
      repo,
    });
    return getPullRequestStatus(client, pullNumber);
  },
});
