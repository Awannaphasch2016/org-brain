export function selectGithubCredentialSource(env?: NodeJS.ProcessEnv):
  | "github-app"
  | "incomplete-app"
  | "github-connector"
  | "app-required"
  | "personal-token"
  | "missing";

export function resolveGithubIdentityFromEnv(input: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  getConnectorToken?: () => Promise<string>;
  log?: (message: string) => void;
  now?: number;
}): Promise<{
  token: string;
  kind: "github-app" | "github-connector" | "personal-token";
  botLogin: string;
  label: string;
}>;

export function formatGithubIdentityLine(identity: { label?: string | null } | null | undefined): string | null;
