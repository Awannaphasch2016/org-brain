import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  githubRepoFromEnv,
  getPullRequestStatus,
  openBaselinePullRequest,
} from "../../../../lib/github.mjs";
import { setYamlPath } from "../../../../lib/project-yaml.mjs";
import { githubClientFromContext } from "../lib/github-token.js";

function decodeContent(content: string) {
  return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export default defineTool({
  description:
    "After a person merges the SRS pull request, open a follow-up pull request that records the merge commit as the approved SRS baseline. Never merges and never edits the frozen TOR.",
  inputSchema: z.object({
    projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    pullNumber: z.number().int().positive(),
    approvedBy: z.string().min(1),
  }),
  approval: always(),
  async execute({ projectId, pullNumber, approvedBy }, ctx) {
    const { owner, repo } = githubRepoFromEnv();
    const client = await githubClientFromContext(ctx);
    const status = await getPullRequestStatus(client, pullNumber);
    if (!status.merged || !status.mergeCommitSha) {
      throw new Error("The SRS pull request is not merged. A person must merge it before a baseline is recorded.");
    }
    const repository = await client.request("GET", `/repos/${owner}/${repo}`);
    const base = repository.default_branch as string;
    const path = `projects/${projectId}/project.yaml`;
    const current = await client.request(
      "GET",
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(base)}`,
    );
    let yaml = decodeContent(current.content);
    const approvedAt = new Date().toISOString();
    yaml = setYamlPath(yaml, "srs.status", "approved");
    yaml = setYamlPath(yaml, "srs.pullRequest", pullNumber);
    yaml = setYamlPath(yaml, "srs.baseline.mergeCommit", status.mergeCommitSha);
    yaml = setYamlPath(yaml, "srs.baseline.approvedAt", approvedAt);
    yaml = setYamlPath(yaml, "srs.baseline.approvedBy", approvedBy);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const opened = await openBaselinePullRequest(client, {
      projectId,
      baseBranch: base,
      stamp,
      merged: true,
      mergeCommitSha: status.mergeCommitSha,
      projectYamlPath: path,
      projectYaml: yaml,
    });
    return {
      ...opened,
      mergeCommitSha: status.mergeCommitSha,
      note: "Follow-up pull request opened. The agent did not merge it.",
    };
  },
});
