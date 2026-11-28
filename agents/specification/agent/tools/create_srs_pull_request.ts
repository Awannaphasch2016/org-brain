import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  buildSrsPullRequestBody,
  createSrsPullRequest,
  githubRepoFromEnv,
} from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { postSrsGateCard, renderSrsGateCard, renderSrsGateNote } from "../../../../lib/srs-gate.mjs";
import { assessPhase3Gate, sha256, validateSrs } from "../../../../lib/srs-validate.mjs";
import { githubClientFromContext } from "../lib/github-token.js";

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
    "Open a pull request for the SRS, elicitation log, and validation report after the approved TOR hash matches. Does not commit docs/_analysis.md or the TOR. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().optional(),
    summaryOfDecisions: z.string().min(1),
    supersededPullNumber: z.number().int().positive().optional(),
    routeApproval: z.object({
      action: z.object({
        requestId: z.string(),
        key: z.string(),
        kind: z.string(),
        title: z.string(),
        statement: z.string(),
        target: z.unknown(),
      }),
    }).optional(),
  }),
  async execute({ projectId, title, summaryOfDecisions, supersededPullNumber, routeApproval }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const projectYaml = await sandbox.readTextFile({ path: `${root}/project.yaml` });
    if (!projectYaml) throw new Error(`Missing ${root}/project.yaml`);
    const project = parseSimpleYaml(projectYaml);
    const torPath = `${root}/${project.tor?.path ?? "docs/tor.md"}`;
    const torText = await sandbox.readTextFile({ path: torPath });
    const planPath = `${root}/${project.projectPlan?.path ?? "docs/project-plan.md"}`;
    const planText = await readOptional(sandbox, planPath);
    const planSha = project.projectPlan?.baseline?.sha256;
    const planPaused = typeof planSha === "string" && planSha.length > 0 && sha256(planText) !== planSha;
    const baseline = await assessPhase3Gate({
      project,
      torText: torText ?? "",
      planPaused,
      ...(routeApproval ? { routeApproval: { client: await githubClientFromContext(ctx), action: routeApproval.action } } : {}),
    });
    if (!baseline.ok || !baseline.sha256) {
      throw new Error(`SRS is blocked until the approved project plan and TOR hash match: ${baseline.reason ?? "projectPlan-not-approved"}`);
    }
    const srs = await readOptional(sandbox, `${root}/docs/srs.md`);
    const elicitationLog = await readOptional(sandbox, `${root}/docs/elicitation-log.md`);
    const analysis = await readOptional(sandbox, `${root}/docs/_analysis.md`);
    const traceability = await readOptional(sandbox, `${root}/docs/traceability.md`);
    const validation = validateSrs({
      srs,
      torText: torText ?? "",
      expectedTorSha256: baseline.sha256,
      elicitationLog,
      analysis,
      traceability,
      changedPaths: [],
    });
    if (!validation.ok) {
      throw new Error(
        `Refusing to open a pull request while validation fails: ${validation.errors.join("; ")}`,
      );
    }
    const report = validation.report;
    await sandbox.writeTextFile({ path: `${root}/docs/validation-report.md`, content: report });
    const files = [
      { path: `${root}/docs/srs.md`, content: srs },
      { path: `${root}/docs/elicitation-log.md`, content: elicitationLog },
      { path: `${root}/docs/validation-report.md`, content: report },
      { path: `${root}/docs/traceability.md`, content: traceability },
    ];
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await createSrsPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      title,
      stamp,
      validationOk: true,
      supersededPullNumber,
      files,
      body: buildSrsPullRequestBody({
        projectId,
        mergeCommit: baseline.mergeCommit ?? null,
        sha256: baseline.sha256,
        summaryOfDecisions,
        warnings: validation.warnings,
      }),
    });
    const note = renderSrsGateNote({
      srs,
      torText: torText ?? "",
      validationOk: validation.ok,
      url: opened.url,
    });
    const card = renderSrsGateCard({
      projectId,
      repo: `${owner}/${repo}`,
      pr: opened.number,
      headSha: opened.headSha,
      note,
    });
    const slack = (ctx as { slack?: { request?: Function; channelId?: string; threadTs?: string }; session?: { slack?: { request?: Function; channelId?: string; threadTs?: string } } }).slack
      ?? (ctx as { session?: { slack?: { request?: Function; channelId?: string; threadTs?: string } } }).session?.slack;
    if (slack?.request && slack.channelId) {
      await postSrsGateCard(
        { request: slack.request, channelId: slack.channelId, threadTs: slack.threadTs },
        card as { text: string; blocks?: readonly Record<string, unknown>[] },
      );
    }
    return baseline.planCheckSkipped
      ? { ...opened, card, sourcePlanCommit: null, sourcePlanSha256: null }
      : { ...opened, card };
  },
});
