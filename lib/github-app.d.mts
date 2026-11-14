export function normalizePrivateKey(value: string): string;
export function createAppJwt(input: { appId: string; privateKey: string; now?: number }): string;
export function mintInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<{ token: string; botLogin: string; slug: string }>;
export function fetchAuthenticatedLogin(token: string, fetchImpl?: typeof fetch): Promise<string>;
