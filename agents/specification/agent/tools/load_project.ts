import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  authorizeProject,
  authorizeSlackActor,
  slackUserIdFromAuth,
} from "../../../../lib/authz.mjs";
import {
  assertInsideProject,
  githubRepoFromEnv,
} from "../../../../lib/github.mjs";
import { parseSimpleYaml } from "../../../../lib/project-yaml.mjs";
import { sha256 } from "../../../../lib/srs-validate.mjs";
import { specificationConfig } from "../../../../generated/config.js";
import { githubClientFromContext } from "../lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "Authorize the current Slack user, then hydrate one project's files from GitHub into the sandbox. Refuses any path outside projects/<id>/ and stops when the frozen TOR hash does not match.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  async execute({ projectId }, ctx) {
    const userId = slackUserIdFromAuth(ctx.session.auth.current);
    const actor = authorizeSlackActor({
      userId,
      allowedUserIds: specificationConfig.allowedUserIds,
    });
    if (!actor.allowed) {
      return { denied: true, fetch: false, reason: actor.reason };
    }

    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const ref = repository.default_branch as string;
    const projectYamlPath = assertInsideProject(projectId, `projects/${projectId}/project.yaml`);
    const yamlPayload = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${projectYamlPath}?ref=${encodeURIComponent(ref)}`,
    );
    const projectYaml = decodeContent(yamlPayload.content);
    const project = parseSimpleYaml(projectYaml);
    const authorized = authorizeProject({
      userId,
      projectAllowedUserIds: project.authorization?.allowedSlackUserIds,
    });
    if (!authorized.allowed) {
      return { denied: true, fetch: false, reason: authorized.reason };
    }

    const tree = await client.request(
      "GET",
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    const prefix = `projects/${projectId}/`;
    const paths = (tree.tree as { path: string; type: string }[])
      .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
      .map((entry) => assertInsideProject(projectId, entry.path));
    const files: Record<string, string> = { [projectYamlPath]: projectYaml };
    for (const path of paths) {
      if (path === projectYamlPath) continue;
      const payload = await client.request(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      files[path] = decodeContent(payload.content);
    }

    const torRelative = project.tor?.path;
    if (project.tor?.status !== "frozen" || typeof torRelative !== "string") {
      throw new Error("TOR baseline is not frozen. Stopping.");
    }
    const torPath = assertInsideProject(projectId, `${prefix}${torRelative}`);
    const torText = files[torPath];
    if (typeof torText !== "string" || sha256(torText) !== project.tor.sha256) {
      throw new Error("TOR hash does not match project.yaml. Stopping.");
    }

    const sandbox = await ctx.getSandbox();
    for (const [path, content] of Object.entries(files)) {
      await sandbox.writeTextFile({ path, content });
    }
    return {
      denied: false,
      fetch: true,
      projectId,
      tor: {
        baselineId: project.tor.baselineId,
        status: project.tor.status,
        sha256: project.tor.sha256,
        gitCommit: project.tor.gitCommit,
      },
    };
  },
});
