import { readFile } from "node:fs/promises";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateIntake } from "../../../../lib/intake-validate.mjs";
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
    "Check a TOR draft, its analysis, and its elicitation log. Reports every failure at once and writes docs/tor-intake-report.md.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async execute({ projectId }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const structureMarkdown = await readFile(
      new URL("../../../../knowledge/guidelines/tor-structure.md", import.meta.url),
      "utf8",
    );
    const result = validateIntake({
      tor: await readOptional(sandbox, `${root}/docs/tor.md`),
      analysis: await readOptional(sandbox, `${root}/docs/tor-analysis.md`),
      elicitationLog: await readOptional(sandbox, `${root}/docs/tor-elicitation-log.md`),
      structureMarkdown,
    });
    const reportPath = `${root}/docs/tor-intake-report.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["tor-intake-report.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, reportPath };
  },
});
