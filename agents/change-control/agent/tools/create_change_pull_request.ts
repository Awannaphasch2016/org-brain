import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { validateChangeReview } from "../../../../lib/change-review.mjs";
import { githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { loadChangeControlSources } from "../../../../lib/project-files.mjs";
import { planStagePullRequest } from "../../../../lib/stage-gate.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Load the approved TOR and SRS, then open a pull request for a change review and, when accepted, the revised SRS. Refuses a baseline hash mismatch, TOR edits, fixtures, and failed validation. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixture: z.boolean().optional(),
    title: z.string().optional(),
  }),
  approval: always(),
  async execute({ projectId, fixture, title }, ctx) {
    const client = await githubClientFromContext(ctx);
    const loaded = await loadChangeControlSources(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (loaded.denied || loaded.stop || !loaded.torText || !loaded.srsText || !loaded.torSha256) {
      throw new Error(`project load stopped: ${loaded.reason ?? "tor.baseline.sha256 is missing"}`);
    }
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const review = (await sandbox.readTextFile({ path: `${root}/docs/change-review.md` })) ?? "";
    const revisedSrs = (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) || loaded.srsText;
    const validation = validateChangeReview({
      review,
      originalSrs: loaded.srsText,
      revisedSrs,
      torText: loaded.torText,
      expectedTorSha256: loaded.torSha256,
    });
    const files = [
      { path: `${root}/docs/change-review.md`, content: review },
      { path: `${root}/docs/change-validation.md`, content: validation.report },
      { path: `${root}/docs/srs.md`, content: revisedSrs },
    ];
    const plan = planStagePullRequest({
      fixture: Boolean(fixture),
      validationOk: validation.ok,
      projectId,
      files,
      allowedDocs: ["change-review.md", "change-validation.md", "srs.md"],
    });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `change/${projectId}/${stamp}`,
      title: title ?? `Specification change for ${projectId}`,
      messagePrefix: "Change",
      files,
      body: "Specification change review. The frozen TOR is not modified. This pull request does not merge itself.",
    });
  },
});
