import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateChangeReview } from "../../../../lib/change-review.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  description:
    "Check a change review against the frozen TOR hash and the current SRS ids. Rejects accepted contradictions and dropped ids.",
  inputSchema: z.object({ projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }),
  async execute({ projectId }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const project = parseSimpleYaml((await sandbox.readTextFile({ path: `${root}/project.yaml` })) ?? "");
    const torText = (await sandbox.readTextFile({ path: `${root}/docs/tor.md` })) ?? "";
    const result = validateChangeReview({
      review: (await sandbox.readTextFile({ path: `${root}/docs/change-review.md` })) ?? "",
      originalSrs: (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) ?? "",
      revisedSrs: (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) ?? "",
      torText,
      expectedTorSha256: project.tor?.sha256 ?? "",
    });
    const reportPath = `${root}/docs/change-validation.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["change-validation.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, reportPath };
  },
});
