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
    "Authorize the user and load an approved architecture baseline, or acknowledge a fixture without treating it as a baseline.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixtureId: z.string().optional(),
  }),
  async execute({ projectId, fixtureId }, ctx) {
    const actor = authorizeSlackActor({
      userId: slackUserIdFromAuth(ctx.session.auth.current),
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (!actor.allowed) return { denied: true, fetch: false, reason: actor.reason };
    if (fixtureId) {
      const input = resolveStageInput({ fixtureId, previousBaselineApproved: false });
      return { denied: false, fetch: false, fixture: true, recordBaseline: false, root: input.root };
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
    const approved =
      project.architecture?.status === "approved" && Boolean(project.architecture?.baseline?.mergeCommit);
    const gate = resolveStageInput({ previousBaselineApproved: approved });
    if (gate.denied) return { denied: true, fetch: false, reason: gate.reason };
    const archPath = assertInsideProject(projectId, `projects/${projectId}/${project.architecture.path}`);
    const archPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${archPath}?ref=${encodeURIComponent(ref)}`,
    );
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({ path: yamlPath, content: yaml });
    await sandbox.writeTextFile({ path: archPath, content: decodeContent(archPayload.content) });
    return { denied: false, fetch: true, fixture: false, recordBaseline: true };
  },
});
