import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateArchitecture } from "../../../../lib/architecture-validate.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  description:
    "Check an architecture draft against the hydrated SRS: required sections, component sources, SRS hash, and excluded customer access.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async execute({ projectId }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const srs = await sandbox.readTextFile({ path: `${root}/docs/srs.md` });
    const architecture = await sandbox.readTextFile({ path: `${root}/docs/architecture.md` });
    if (!srs || !architecture) throw new Error("SRS and architecture drafts must both be present.");
    const result = validateArchitecture({ architecture, srs });
    const reportPath = `${root}/docs/architecture-validation.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["architecture-validation.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, warnings: result.warnings, reportPath };
  },
});
