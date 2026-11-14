import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { validateChangeReview } from "../../../../lib/change-review.mjs";
import { githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { planStagePullRequest } from "../../../../lib/stage-gate.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Open a pull request for a change review and, when accepted, the revised SRS. Refuses TOR edits, fixtures, and failed validation. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixture: z.boolean().optional(),
    title: z.string().optional(),
  }),
  approval: always(),
  async execute({ projectId, fixture, title }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const projectYaml = (await sandbox.readTextFile({ path: `${root}/project.yaml` })) ?? "";
    const project = parseSimpleYaml(projectYaml);
    const torText = (await sandbox.readTextFile({ path: `${root}/docs/tor.md` })) ?? "";
    const review = (await sandbox.readTextFile({ path: `${root}/docs/change-review.md` })) ?? "";
    const srs = (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) ?? "";
    const validation = validateChangeReview({
      review,
      originalSrs: srs,
      revisedSrs: srs,
      torText,
      expectedTorSha256: project.tor?.sha256 ?? "",
    });
    const files = [
      { path: `${root}/docs/change-review.md`, content: review },
      { path: `${root}/docs/change-validation.md`, content: validation.report },
      { path: `${root}/docs/srs.md`, content: srs },
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
    const client = await githubClientFromContext(ctx);
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
