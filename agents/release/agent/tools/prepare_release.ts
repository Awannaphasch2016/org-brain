import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { GithubClient, githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { planRelease, verifyAcceptance } from "../../../../lib/release.mjs";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "After human approval, open a pull request that records release verification. Does not deploy and refuses fixtures.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    torUnchanged: z.boolean(),
    fixture: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, torUnchanged, fixture }, ctx) {
    const sandbox = await ctx.getSandbox();
    const path = `projects/${projectId}/docs/release-verification.md`;
    const evidence = (await sandbox.readTextFile({ path })) ?? "";
    const verification = verifyAcceptance({ evidence, torUnchanged });
    const plan = planRelease({ fixture: Boolean(fixture), verificationOk: verification.ok });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `release/${projectId}/${stamp}`,
      title: `Release verification for ${projectId}`,
      files: [{ path, content: verification.report }],
      body: `${verification.report}\nThis pull request does not merge itself and does not deploy the application.`,
    });
    return { ...opened, deployed: false, requests: plan.requests };
  },
});
