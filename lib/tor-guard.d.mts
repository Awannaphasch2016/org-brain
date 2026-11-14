export function torWriteAllowed(input: {
  filePath: string;
  branch?: string;
  grant?: { agent: string; projectId: string; branchPrefix: string } | null;
}): { applies: boolean; allowed: boolean; reason?: string };

export function issueTorWriteGrant(
  client: { owner: string; repo: string; request: Function },
  projectId: string,
): Promise<{ ok: true; grant: { agent: "tor"; projectId: string; branchPrefix: string } } | { ok: false; reason: string }>;
