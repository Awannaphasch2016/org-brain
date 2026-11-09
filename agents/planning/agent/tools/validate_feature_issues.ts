import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateFeatureIssues } from "../../../../lib/issues-validate.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  description:
    "Check the feature-issue draft for ids, architecture sources, acceptance lines, and an acyclic dependency graph.",
  inputSchema: z.object({ projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }),
  async execute({ projectId }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const architecture = await sandbox.readTextFile({ path: `${root}/docs/architecture.md` });
    const issues = await sandbox.readTextFile({ path: `${root}/docs/feature-issues.md` });
    if (!architecture || !issues) throw new Error("Architecture and feature-issues drafts must both be present.");
    const result = validateFeatureIssues({ issuesMarkdown: issues, architecture });
    const reportPath = `${root}/docs/issues-validation.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["issues-validation.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, order: result.order, reportPath };
  },
});
