import { defineTool } from "eve/tools";
import { z } from "zod";
import { verifyAcceptance } from "../../../../lib/release.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  description:
    "Check release evidence for passing tests, a named implementation baseline, and an unchanged TOR. Does not deploy.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    torUnchanged: z.boolean(),
  }),
  async execute({ projectId, torUnchanged }, ctx) {
    const sandbox = await ctx.getSandbox();
    const evidence = (await sandbox.readTextFile({ path: `projects/${projectId}/docs/release-verification.md` })) ?? "";
    const result = verifyAcceptance({ evidence, torUnchanged });
    const reportPath = `projects/${projectId}/docs/release-verification.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["release-verification.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, deployed: false, reportPath };
  },
});
