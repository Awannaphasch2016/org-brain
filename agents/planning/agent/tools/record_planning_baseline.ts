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
    "After a person merges the issue plan, open a follow-up pull request recording that merge commit. Never merges and never records a fixture.",
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
    if (!status.merged || !status.mergeCommitSha) throw new Error("The issue-plan pull request is not merged.");
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const path = `projects/${projectId}/project.yaml`;
    const current = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(repository.default_branch)}`,
    );
    let yaml = decodeContent(current.content);
    yaml = setYamlPath(yaml, "planning.status", "approved");
    yaml = setYamlPath(yaml, "planning.pullRequest", pullNumber);
    yaml = setYamlPath(yaml, "planning.baseline.mergeCommit", status.mergeCommitSha);
    yaml = setYamlPath(yaml, "planning.baseline.approvedBy", approvedBy);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return openReviewedPullRequest(client, {
      projectId,
      baseBranch: repository.default_branch,
      branch: `plan/${projectId}/baseline/${stamp}`,
      title: `Record planning baseline for ${projectId}`,
      files: [{ path, content: yaml, sha: current.sha }],
      body: `Records planning baseline \`${status.mergeCommitSha}\`. This pull request does not merge itself.`,
    });
  },
});