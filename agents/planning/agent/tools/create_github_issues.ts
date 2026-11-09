import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { GithubClient, getPullRequestStatus, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { planGithubIssueWrites, validateFeatureIssues } from "../../../../lib/issues-validate.mjs";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "After the issue-plan pull request is merged, create one GitHub issue per approved item. Refuses fixtures. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
    fixture: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, pullNumber, fixture }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const architecture = (await sandbox.readTextFile({ path: `${root}/docs/architecture.md` })) ?? "";
    const issuesMarkdown = (await sandbox.readTextFile({ path: `${root}/docs/feature-issues.md` })) ?? "";
    const validation = validateFeatureIssues({ issuesMarkdown, architecture });
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    const status = fixture ? { merged: false } : await getPullRequestStatus(client, pullNumber);
    const plan = planGithubIssueWrites({
      fixture: Boolean(fixture),
      merged: Boolean(status.merged),
      issues: validation.issues,
    });
    if (!plan.ok) throw new Error(plan.error);
    const created = [];
    for (const issue of validation.issues) {
      const response = await client.request("POST", `/repos/${owner}/${repo}/issues`, {
        body: {
          title: issue.title,
          body: `${issue.body}\n\nSource plan pull request: #${pullNumber}`,
        },
      });
      created.push({ id: issue.id, number: response.number, url: response.html_url });
    }
    return { created, mergedByAgent: false };
  },
});
