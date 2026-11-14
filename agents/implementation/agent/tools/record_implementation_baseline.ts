import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  getPullRequestStatus,
  githubRepoFromEnv,
  openReviewedPullRequest,
} from "../../../../lib/github.mjs";
import { setYamlPath } from "../../../../lib/project-yaml.mjs";
import { githubClientFromContext } from "../../../specification/agent/lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "After a person merges an implementation pull request, open a follow-up pull request that records the merge commit. Never merges.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
    approvedBy: z.string().min(1),
    fixture: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ projectId, pullNumber, approvedBy, fixture }, ctx) {
    if (fixture) throw new Error("Refusing to record a baseline from a fixture.");
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const status = await getPullRequestStatus(client, pullNumber);
    if (!status.merged || !status.mergeCommitSha) throw new Error("The implementation pull request is not merged.");
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const path = `projects/${projectId}/project.yaml`;
    const current = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(repository.default_branch)}`,
    );
    let yaml = decodeContent(current.content);
    yaml = setYamlPath(yaml, "implementation.status", "approved");
    yaml = setYamlPath(yaml, "implementation.pullRequest", pullNumber);
    yaml = setYamlPath(yaml, "implementation.baseline.mergeCommit", status.mergeCommitSha);
    yaml = setYamlPath(yaml, "implementation.baseline.approvedBy", approvedBy);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `impl/${projectId}/baseline/${stamp}`,
      title: `Record implementation baseline for ${projectId}`,
      files: [{ path, content: yaml, sha: current.sha }],
      body: `Records implementation baseline \`${status.mergeCommitSha}\`. This pull request does not merge itself.`,
    });
  },
});