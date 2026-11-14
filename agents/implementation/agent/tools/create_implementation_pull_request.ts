import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { planImplementationPullRequest } from "../../../../lib/implementation.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Open a pull request for src, tests, and the implementation report after tests pass. Refuses fixtures and failing tests. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    issueId: z.string().regex(/^ISS-\d{3}$/),
    testsOk: z.boolean(),
    fixture: z.boolean().optional(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
  }),
  approval: always(),
  async execute({ projectId, issueId, testsOk, fixture, files }, ctx) {
    const plan = planImplementationPullRequest({
      fixture: Boolean(fixture),
      testsOk,
      projectId,
      files,
    });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `impl/${projectId}/${issueId.toLowerCase()}/${stamp}`,
      title: `${issueId} for ${projectId}`,
      messagePrefix: issueId,
      files,
      body: `Implements ${issueId}. Tests were reported passing. This pull request does not merge itself.`,
    });
  },
});
