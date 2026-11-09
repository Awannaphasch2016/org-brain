import { defineTool } from "eve/tools";
import { z } from "zod";
import { authorizeSlackActor, slackUserIdFromAuth } from "../../../../lib/authz.mjs";
import { GithubClient, assertInsideProject, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { sha256 } from "../../../../lib/srs-validate.mjs";
import { resolveStageInput } from "../../../../lib/stage-gate.mjs";
import { factoryConfig } from "../../../../generated/config.js";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "Authorize the Slack user and load an approved SRS baseline, or acknowledge a fixture without treating it as a baseline.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    fixtureId: z.string().optional(),
  }),
  async execute({ projectId, fixtureId }, ctx) {
    const userId = slackUserIdFromAuth(ctx.session.auth.current);
    const actor = authorizeSlackActor({
      userId,
      allowedUserIds: factoryConfig.allowedUserIds,
    });
    if (!actor.allowed) return { denied: true, fetch: false, reason: actor.reason };
    if (fixtureId) {
      const input = resolveStageInput({ fixtureId, previousBaselineApproved: false });
      return {
        denied: false,
        fetch: false,
        fixture: true,
        recordBaseline: input.recordBaseline,
        root: input.root,
      };
    }
    const { owner, repo } = githubRepoFromEnv();
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const ref = repository.default_branch as string;
    const yamlPath = assertInsideProject(projectId, `projects/${projectId}/project.yaml`);
    const yamlPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${yamlPath}?ref=${encodeURIComponent(ref)}`,
    );
    const project = parseSimpleYaml(decodeContent(yamlPayload.content));
    const approved = project.srs?.status === "approved" && Boolean(project.srs?.baseline?.mergeCommit);
    const gate = resolveStageInput({ previousBaselineApproved: approved });
    if (gate.denied) return { denied: true, fetch: false, reason: gate.reason };
    const srsPath = assertInsideProject(projectId, `projects/${projectId}/${project.srs.path}`);
    const srsPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${srsPath}?ref=${encodeURIComponent(ref)}`,
    );
    const srs = decodeContent(srsPayload.content);
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({ path: yamlPath, content: decodeContent(yamlPayload.content) });
    await sandbox.writeTextFile({ path: srsPath, content: srs });
    return {
      denied: false,
      fetch: true,
      fixture: false,
      recordBaseline: true,
      srsSha256: sha256(srs),
      srsBaseline: project.srs.baseline.mergeCommit,
    };
  },
});
