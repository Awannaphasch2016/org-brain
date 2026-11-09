import { connect } from "@vercel/connect/eve";

type TokenContext = {
  getToken: (
    authorization: ReturnType<typeof connect>,
  ) => Promise<{ token?: string }>;
};

export async function resolveGithubToken(ctx: TokenContext) {
  const connector = process.env.GITHUB_CONNECTOR;
  if (connector) {
    const { token } = await ctx.getToken(
      connect({ connector, principalType: "app" }),
    );
    if (!token) throw new Error("GitHub connector returned an empty token.");
    return token;
  }
  const pat = process.env.GITHUB_TOKEN;
  if (!pat) {
    throw new Error(
      "Set GITHUB_TOKEN (fine-grained PAT) or GITHUB_CONNECTOR (GitHub App via Vercel Connect).",
    );
  }
  return pat;
}
