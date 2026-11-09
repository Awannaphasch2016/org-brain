import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  GithubClient,
  getPullRequestStatus,
  githubRepoFromEnv,
  openReviewedPullRequest,
} from "../../../../lib/github.mjs";
import { setYamlPath } from "../../../../lib/project-yaml.mjs";
import { resolveGithubToken } from "../../../specification/agent/lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "After a person merges the architecture pull request, open a follow-up pull request that records the merge commit. Never merges and never records a fixture.",
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
    const client = new GithubClient({ token: await resolveGithubToken(ctx), owner, repo });
    const status = await getPullRequestStatus(client, pullNumber);
    if (!status.merged || !status.mergeCommitSha) {
      throw new Error("The architecture pull request is not merged.");
    }
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const base = repository.default_branch as string;
    const path = `projects/${projectId}/project.yaml`;
    const current = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(base)}`,
    );
    let yaml = decodeContent(current.content);
    yaml = setYamlPath(yaml, "architecture.status", "approved");
    yaml = setYamlPath(yaml, "architecture.pullRequest", pullNumber);
    yaml = setYamlPath(yaml, "architecture.baseline.mergeCommit", status.mergeCommitSha);
    yaml = setYamlPath(yaml, "architecture.baseline.approvedBy", approvedBy);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await openReviewedPullRequest(client, {
      projectId,
      baseBranch: base,
      branch: `arch/${projectId}/baseline/${stamp}`,
      title: `Record architecture baseline for ${projectId}`,
      messagePrefix: "Record architecture baseline",
      files: [{ path, content: yaml, sha: current.sha }],
      body: `Records architecture baseline \`${status.mergeCommitSha}\`. This pull request does not merge itself.`,
    });
    return { ...opened, mergeCommitSha: status.mergeCommitSha, deployed: false };
  },
});
