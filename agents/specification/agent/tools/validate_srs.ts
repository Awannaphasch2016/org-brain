import { defineTool } from "eve/tools";
import { z } from "zod";
import { readTorBaselineSha256 } from "../../../../lib/baseline.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { validateSrs } from "../../../../lib/srs-validate.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";

async function readOptional(
  sandbox: { readTextFile: (input: { path: string }) => PromiseLike<string | null> },
  path: string,
) {
  try {
    return (await sandbox.readTextFile({ path })) ?? "";
  } catch {
    return "";
  }
}

export default defineTool({
  description:
    "Deterministically validate the hydrated SRS: required sections, unique ids, sources, acceptance links, TOR hash, TOR path changes, blocking gaps, and unresolved TOR conflicts. Writes validation-report.md.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    changedPaths: z.array(z.string()).optional(),
  }),
  async execute({ projectId, changedPaths }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const projectYaml = await sandbox.readTextFile({ path: `${root}/project.yaml` });
    if (!projectYaml) throw new Error(`Missing ${root}/project.yaml`);
    const project = parseSimpleYaml(projectYaml);
    const baseline = readTorBaselineSha256(project);
    if (!baseline.ok || !baseline.sha256 || !baseline.path) {
      return {
        ok: false,
        errors: [`project.yaml is not the new format: ${baseline.reason ?? "tor.baseline.sha256 is missing"}`],
        warnings: [],
        reportPath: null,
      };
    }
    const torPath = `${root}/${baseline.path}`;
    const torText = await sandbox.readTextFile({ path: torPath });
    if (!torText) throw new Error(`Missing frozen TOR at ${torPath}`);
    const result = validateSrs({
      srs: await readOptional(sandbox, `${root}/docs/srs.md`),
      torText,
      expectedTorSha256: baseline.sha256,
      elicitationLog: await readOptional(sandbox, `${root}/docs/elicitation-log.md`),
      analysis: await readOptional(sandbox, `${root}/docs/_analysis.md`),
      changedPaths: changedPaths ?? [],
    });
    const reportPath = `${root}/docs/validation-report.md`;
    const decision = assessWrite(reportPath);
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      reportPath,
    };
  },
});
