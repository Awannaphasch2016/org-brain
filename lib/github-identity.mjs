import { fetchAuthenticatedLogin, mintInstallationToken } from "./github-app.mjs";

export function selectGithubCredentialSource(env = process.env) {
  const hasAppId = Boolean(env.GITHUB_APP_ID);
  const hasKey = Boolean(env.GITHUB_APP_PRIVATE_KEY);
  const hasInstallation = Boolean(env.GITHUB_APP_INSTALLATION_ID);
  if (hasAppId || hasKey || hasInstallation) {
    if (!hasAppId || !hasKey || !hasInstallation) return "incomplete-app";
    return "github-app";
  }
  if (env.GITHUB_CONNECTOR) return "github-connector";
  if (env.FACTORY_REQUIRE_APP === "1") return "app-required";
  if (env.GITHUB_TOKEN) return "personal-token";
  return "missing";
}

function identityLabel(kind, login) {
  return `${kind} (${login})`;
}

export async function resolveGithubIdentityFromEnv({
  env = process.env,
  fetchImpl = fetch,
  getConnectorToken,
  log = console.info,
  now,
}) {
  const source = selectGithubCredentialSource(env);
  if (source === "incomplete-app") {
    throw new Error(
      "GitHub App credentials are incomplete. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID together.",
    );
  }
  if (source === "github-app") {
    const minted = await mintInstallationToken({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
      fetchImpl,
      now,
    });
    const identity = {
      token: minted.token,
      kind: "github-app",
      botLogin: minted.botLogin,
      label: identityLabel("github-app", minted.botLogin),
    };
    log(`[github-identity] kind=${identity.kind} login=${identity.botLogin}`);
    return identity;
  }
  if (source === "github-connector") {
    if (typeof getConnectorToken !== "function") {
      throw new Error("GitHub connector token callback is missing.");
    }
    const token = await getConnectorToken();
    if (!token) throw new Error("GitHub connector returned an empty token.");
    const botLogin = await fetchAuthenticatedLogin(token, fetchImpl);
    const identity = {
      token,
      kind: "github-connector",
      botLogin,
      label: identityLabel("github-connector", botLogin),
    };
    log(`[github-identity] kind=${identity.kind} login=${identity.botLogin}`);
    return identity;
  }
  if (source === "app-required") {
    throw new Error("FACTORY_REQUIRE_APP=1 refuses the personal-token fallback. Configure the GitHub App.");
  }
  if (source === "personal-token") {
    const botLogin = await fetchAuthenticatedLogin(env.GITHUB_TOKEN, fetchImpl);
    const identity = {
      token: env.GITHUB_TOKEN,
      kind: "personal-token",
      botLogin,
      label: identityLabel("personal-token", botLogin),
    };
    log(`[github-identity] kind=${identity.kind} login=${identity.botLogin}`);
    return identity;
  }
  throw new Error(
    "Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID, or GITHUB_CONNECTOR, or GITHUB_TOKEN.",
  );
}

export function formatGithubIdentityLine(identity) {
  if (!identity?.label) return null;
  return `GitHub identity: ${identity.label}`;
}
