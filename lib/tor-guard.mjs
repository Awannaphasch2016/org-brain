import { parseSimpleYaml } from "./project-yaml.mjs";

export function torWriteAllowed({ filePath, branch, grant }) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  if (!/(?:^|\/)docs\/tor\.md$/.test(normalized)) return { applies: false, allowed: true };
  const match = normalized.match(/(?:^|\/)projects\/([^/]+)\/docs\/tor\.md$/);
  const projectId = match?.[1] ?? grant?.projectId;
  const sameProject = Boolean(grant) && grant.agent === "tor" && grant.projectId === projectId;
  if (!sameProject) {
    return { applies: true, allowed: false, reason: "the frozen TOR must not be modified" };
  }
  const prefix = grant.branchPrefix;
  if (typeof branch !== "string" || !prefix || !branch.startsWith(prefix) || branch.includes("/baseline/")) {
    return {
      applies: true,
      allowed: false,
      reason: "TOR writes are limited to this project's tor/ pull request",
    };
  }
  return { applies: true, allowed: true };
}

export async function issueTorWriteGrant(client, projectId) {
  const { readRepoTextFile } = await import("./github.mjs");
  const repository = await client.request("GET", `/repos/${client.owner}/${client.repo}`);
  const base = repository?.default_branch;
  if (typeof base !== "string" || !base) throw new Error("repository has no default branch");
  const yamlPath = `projects/${projectId}/project.yaml`;
  const yaml = await readRepoTextFile(client, yamlPath, base);
  if (yaml == null) return { ok: false, reason: "project.yaml is not on the default branch" };
  const project = parseSimpleYaml(yaml);
  if (project.status === "rejected") return { ok: false, reason: "the project is rejected" };
  if (project.status !== "active" || project.tor?.status !== "none") {
    return { ok: false, reason: "TOR is not open for drafting" };
  }
  const torPath = `projects/${projectId}/${project.tor?.path ?? "docs/tor.md"}`;
  const tor = await readRepoTextFile(client, torPath, base);
  if (tor != null) return { ok: false, reason: "docs/tor.md already exists on the default branch" };
  return {
    ok: true,
    grant: { agent: "tor", projectId, branchPrefix: `tor/${projectId}/` },
  };
}
