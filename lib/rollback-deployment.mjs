const VERCEL_API = "https://api.vercel.com";

export async function deploymentCommitSha(deploymentId, { token, teamId, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || token.trim() === "" || typeof deploymentId !== "string") return null;
  const team = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const response = await fetchImpl(`${VERCEL_API}/v13/deployments/${deploymentId}${team}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response?.ok) return null;
  const payload = await response.json();
  return payload?.meta?.githubCommitSha ?? null;
}
