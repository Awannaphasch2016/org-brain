import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { validateArchitecture } from "../../../../lib/architecture-validate.mjs";
import { githubRepoFromEnv, openReviewedPullRequest } from "../../../../lib/github.mjs";
import { planStagePullRequest } from "../../../../lib/stage-gate.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Open a pull request for the architecture and its validation report. Refuses fixtures, failed validation, and TOR edits. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixture: z.boolean().optional(),
    title: z.string().optional(),
  }),
  approval: always(),
  async execute({ projectId, fixture, title }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const srs = (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) ?? "";
    const architecture = (await sandbox.readTextFile({ path: `${root}/docs/architecture.md` })) ?? "";
    const validation = validateArchitecture({ architecture, srs });
    const files = [
      { path: `${root}/docs/architecture.md`, content: architecture },
      { path: `${root}/docs/architecture-validation.md`, content: validation.report },
    ];
    const plan = planStagePullRequest({
      fixture: Boolean(fixture),
      validationOk: validation.ok,
      projectId,
      files,
      allowedDocs: ["architecture.md", "architecture-validation.md"],
    });
    if (!plan.ok) throw new Error(plan.error);
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `arch/${projectId}/${stamp}`,
      title: title ?? `Architecture for ${projectId}`,
      messagePrefix: "Architecture",
      files,
      body: [
        `Architecture design for \`${projectId}\`.`,
        "",
        `SRS baseline hash: \`${validation.srsSha256}\``,
        "",
        validation.ok ? "Validation passed." : "Validation failed.",
        "",
        "This pull request does not merge itself.",
      ].join("\n"),
    });
  },
});
