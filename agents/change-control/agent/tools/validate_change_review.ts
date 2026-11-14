import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { validateChangeReview } from "../../../../lib/change-review.mjs";
import { loadChangeControlSources } from "../../../../lib/project-files.mjs";
import { assessWrite } from "../../../../lib/write-policy.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

export default defineTool({
  description:
    "Load the approved TOR and SRS baselines, then check a change review against tor.baseline.sha256 and the current SRS ids. Rejects accepted contradictions and dropped ids.",
  inputSchema: z.object({ projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }),
  async execute({ projectId }, ctx) {
    const client = await githubClientFromContext(ctx);
    const loaded = await loadChangeControlSources(client, {
      projectId,
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (loaded.denied || loaded.stop || !loaded.torText || !loaded.srsText || !loaded.torSha256) {
      return {
        ok: false,
        errors: [`project load stopped: ${loaded.reason ?? "tor.baseline.sha256 is missing"}`],
        reportPath: null,
      };
    }
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    await sandbox.writeTextFile({ path: `${root}/project.yaml`, content: loaded.projectYaml ?? "" });
    await sandbox.writeTextFile({ path: loaded.torPath ?? `${root}/docs/tor.md`, content: loaded.torText });
    const revisedSrs = (await sandbox.readTextFile({ path: `${root}/docs/srs.md` })) || loaded.srsText;
    const result = validateChangeReview({
      review: (await sandbox.readTextFile({ path: `${root}/docs/change-review.md` })) ?? "",
      originalSrs: loaded.srsText,
      revisedSrs,
      torText: loaded.torText,
      expectedTorSha256: loaded.torSha256,
    });
    const reportPath = `${root}/docs/change-validation.md`;
    const decision = assessWrite(reportPath, { allowedDocs: ["change-validation.md"] });
    if (!decision.allowed) throw new Error(decision.reason);
    await sandbox.writeTextFile({ path: reportPath, content: result.report });
    return { ok: result.ok, errors: result.errors, reportPath };
  },
});
