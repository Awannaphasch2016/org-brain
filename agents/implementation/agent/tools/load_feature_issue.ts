import { defineTool } from "eve/tools";
import { z } from "zod";
import { authorizeSlackActor, slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { assertInsideProject, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { resolveStageInput } from "../../../../lib/stage-gate.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "Authorize the user and load one approved feature-issue baseline, or acknowledge a fixture without treating it as a baseline.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    issueId: z.string().regex(/^ISS-\d{3}$/),
    fixtureId: z.string().optional(),
  }),
  async execute({ projectId, issueId, fixtureId }, ctx) {
    const actor = authorizeSlackActor({
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (!actor.allowed) return { denied: true, fetch: false, reason: actor.reason };
    if (fixtureId) {
      const input = resolveStageInput({ fixtureId, previousBaselineApproved: false });
      return { denied: false, fixture: true, recordBaseline: false, issueId, root: input.root };
    }
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const ref = repository.default_branch as string;
    const yamlPath = assertInsideProject(projectId, `projects/${projectId}/project.yaml`);
    const yamlPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${yamlPath}?ref=${encodeURIComponent(ref)}`,
    );
    const yaml = decodeContent(yamlPayload.content);
    const project = parseSimpleYaml(yaml);
    const approved = project.planning?.status === "approved" && Boolean(project.planning?.baseline?.mergeCommit);
    const gate = resolveStageInput({ previousBaselineApproved: approved });
    if (gate.denied) return { denied: true, fetch: false, reason: gate.reason };
    const issuesPath = assertInsideProject(projectId, `projects/${projectId}/${project.planning.path}`);
    const issuesPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${issuesPath}?ref=${encodeURIComponent(ref)}`,
    );
    const issues = decodeContent(issuesPayload.content);
    if (!issues.includes(`## ${issueId}`)) throw new Error(`${issueId} is not in the approved issue plan.`);
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({ path: yamlPath, content: yaml });
    await sandbox.writeTextFile({ path: issuesPath, content: issues });
    return { denied: false, fixture: false, recordBaseline: true, issueId };
  },
});
