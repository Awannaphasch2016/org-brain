import { getToken } from "@vercel/connect";
import { connect } from "@vercel/connect/eve";
import { GithubClient, githubRepoFromEnv } from "../../../../lib/github.mjs";
import { resolveGithubIdentityFromEnv } from "../../../../lib/github-identity.mjs";

type TokenContext = {
  getToken: (
    authorization: ReturnType<typeof connect>,
  ) => Promise<{ token?: string }>;
};

type GithubIdentity = {
  token: string;
  kind: "github-app" | "github-connector" | "personal-token";
  botLogin: string;
  label: string;
};

async function connectorToken(ctx: TokenContext) {
  const connector = process.env.GITHUB_CONNECTOR;
  if (!connector) throw new Error("GITHUB_CONNECTOR is not set.");
  const { token } = await ctx.getToken(connect({ connector, principalType: "app" }));
  if (!token) throw new Error("GitHub connector returned an empty token.");
  return token;
}

export async function resolveGithubIdentity(ctx: TokenContext): Promise<GithubIdentity> {
  return resolveGithubIdentityFromEnv({
    env: process.env,
    fetchImpl: fetch,
    getConnectorToken: () => connectorToken(ctx),
  });
}

export async function resolveGithubToken(ctx: TokenContext) {
  const identity = await resolveGithubIdentity(ctx);
  return identity.token;
}

function clientFromIdentity(identity: GithubIdentity) {
  const { owner, repo } = githubRepoFromEnv();
  return new GithubClient({
    token: identity.token,
    owner,
    repo,
    identity,
  });
}

export async function githubClientFromContext(ctx: TokenContext) {
  return clientFromIdentity(await resolveGithubIdentity(ctx));
}

export async function createGateGithubClient() {
  const identity = await resolveGithubIdentityFromEnv({
    env: process.env,
    fetchImpl: fetch,
    getConnectorToken: async () => {
      const connector = process.env.GITHUB_CONNECTOR;
      if (!connector) throw new Error("GITHUB_CONNECTOR is not set.");
      return getToken(connector, { subject: { type: "app" } });
    },
  });
  return clientFromIdentity(identity);
}
