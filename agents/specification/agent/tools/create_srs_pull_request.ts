import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  GithubClient,
  buildSrsPullRequestBody,
  createSrsPullRequest,
  githubRepoFromEnv,
} from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { validateSrs } from "../../../../lib/srs-validate.mjs";
import { resolveGithubToken } from "../lib/github-token.js";

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
    "Create an isolated branch and open a pull request for the SRS, elicitation log, analysis, and validation report. Never commits the frozen TOR and never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    title: z.string().optional(),
    summaryOfDecisions: z.string().min(1),
  }),
  approval: always(),
  async execute({ projectId, title, summaryOfDecisions }, ctx) {
    const sandbox = await ctx.getSandbox();
    const root = `projects/${projectId}`;
    const projectYaml = await sandbox.readTextFile({ path: `${root}/project.yaml` });
    if (!projectYaml) throw new Error(`Missing ${root}/project.yaml`);
    const project = parseSimpleYaml(projectYaml);
    const torText = await sandbox.readTextFile({ path: `${root}/${project.tor.path}` });
    if (!torText) throw new Error("Missing frozen TOR");
    const srs = await readOptional(sandbox, `${root}/docs/srs.md`);
    const elicitationLog = await readOptional(sandbox, `${root}/docs/elicitation-log.md`);
    const analysis = await readOptional(sandbox, `${root}/docs/_analysis.md`);
    const validation = validateSrs({
      srs,
      torText,
      expectedTorSha256: project.tor.sha256,
      elicitationLog,
      analysis,
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
    ];
    if (analysis.trim()) {
      files.push({ path: `${root}/docs/_analysis.md`, content: analysis });
    }
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({
      token: await resolveGithubToken(ctx),
      owner,
      repo,
    });
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await createSrsPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      title,
      stamp,
      validationOk: true,
      files,
      body: buildSrsPullRequestBody({
        projectId,
        baselineId: project.tor.baselineId,
        gitCommit: project.tor.gitCommit,
        sha256: project.tor.sha256,
        summaryOfDecisions,
        warnings: validation.warnings,
      }),
    });
    return opened;
  },
});
