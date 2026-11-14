import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { loadApprovedTor } from "../../../../lib/project-files.mjs";
import { planRelease, verifyAcceptance } from "../../../../lib/release.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "After human approval, open a pull request that records release verification. The TOR check uses tor.baseline.sha256. Does not deploy and refuses fixtures.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixture: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, fixture }, ctx) {
    const client = await githubClientFromContext(ctx);
    const loaded = await loadApprovedTor(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    const sandbox = await ctx.getSandbox();
    const path = `projects/${projectId}/docs/release-verification.md`;
    const evidence = (await sandbox.readTextFile({ path })) ?? "";
    const torUnchanged = loaded.denied !== true && loaded.stop !== true;
    const verification = verifyAcceptance({ evidence, torUnchanged });
    if (!torUnchanged) {
      verification.ok = false;
      verification.errors = [...verification.errors, loaded.reason ?? "tor-hash-mismatch"];
    }
    const plan = planRelease({ fixture: Boolean(fixture), verificationOk: verification.ok });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
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