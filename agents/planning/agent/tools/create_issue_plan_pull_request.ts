import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { GithubClient, githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { validateFeatureIssues } from "../../../../lib/issues-validate.mjs";
import { planStagePullRequest } from "../../../../lib/stage-gate.mjs";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Open a pull request for the feature-issue plan and its validation report. Refuses fixtures and failed validation. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixture: z.boolean().optional(),
    title: z.string().optional(),
  }),
  approval: always(),
  async execute({ projectId, fixture, title }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const architecture = (await sandbox.readTextFile({ path: `${root}/docs/architecture.md` })) ?? "";
    const issues = (await sandbox.readTextFile({ path: `${root}/docs/feature-issues.md` })) ?? "";
    const validation = validateFeatureIssues({ issuesMarkdown: issues, architecture });
    const files = [
      { path: `${root}/docs/feature-issues.md`, content: issues },
      { path: `${root}/docs/issues-validation.md`, content: validation.report },
    ];
    const plan = planStagePullRequest({
      fixture: Boolean(fixture),
      validationOk: validation.ok,
      projectId,
      files,
      allowedDocs: ["feature-issues.md", "issues-validation.md"],
    });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `plan/${projectId}/${stamp}`,
      title: title ?? `Feature issues for ${projectId}`,
      messagePrefix: "Plan",
      files,
      body: "Feature-issue plan. This pull request does not merge itself and does not create GitHub issues yet.",
    });
  },
});
