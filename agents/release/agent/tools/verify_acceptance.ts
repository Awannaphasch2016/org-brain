import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { loadApprovedTor } from "../../../../lib/project-files.mjs";
import { verifyAcceptance } from "../../../../lib/release.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Check release evidence for passing tests, a named implementation baseline, and docs/tor.md matching tor.baseline.sha256 at the approved baseline and at HEAD. Does not deploy.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async execute({ projectId }, ctx) {
    const client = await githubClientFromContext(ctx);
    const loaded = await loadApprovedTor(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    const torUnchanged = loaded.denied !== true && loaded.stop !== true;
    const sandbox = await ctx.getSandbox();
    const evidence = (await sandbox.readTextFile({ path: `projects/${projectId}/docs/release-verification.md` })) ?? "";
    const result = verifyAcceptance({ evidence, torUnchanged });
    const errors = torUnchanged ? result.errors : [...result.errors, loaded.reason ?? "tor-hash-mismatch"];
    const reportPath = `projects/${projectId}/docs/release-verification.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["release-verification.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    const report = torUnchanged
      ? result.report
      : result.report.replace("## Errors\n\n", `## Errors\n\n- ${loaded.reason ?? "tor-hash-mismatch"}\n`);
    await sandbox.writeTextFile({ path: reportPath, content: report });
    return { ok: result.ok && torUnchanged, errors, deployed: false, reportPath };
  },
});
