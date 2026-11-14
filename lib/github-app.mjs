import { createSign } from "node:crypto";

const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "wewebplus-software-factory",
  "x-github-api-version": "2022-11-28",
};

export function normalizePrivateKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("GitHub App private key is missing.");
  }
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  if (!key.includes("BEGIN")) {
    throw new Error("GitHub App private key must be a PEM.");
  }
  return key;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function createAppJwt({ appId, privateKey, now = Date.now() }) {
  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: issued - 60,
      exp: issued + 9 * 60,
      iss: String(appId),
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

async function githubFetch(fetchImpl, method, url, bearer) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      ...GITHUB_HEADERS,
      authorization: `Bearer ${bearer}`,
    },
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`GitHub ${method} ${new URL(url).pathname} failed (${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message.slice(0, 160) : response.statusText;
    throw new Error(`GitHub ${method} ${new URL(url).pathname} failed (${response.status}): ${message}`);
  }
  return payload;
}

export async function mintInstallationToken({ appId, privateKey, installationId, fetchImpl = fetch, now = Date.now() }) {
  const key = normalizePrivateKey(privateKey);
  const jwt = createAppJwt({ appId, privateKey: key, now });
  const app = await githubFetch(fetchImpl, "GET", "https://api.github.com/app", jwt);
  if (typeof app.slug !== "string" || !app.slug) {
    throw new Error("GitHub App identity did not include a slug.");
  }
  const minted = await githubFetch(
    fetchImpl,
    "POST",
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    jwt,
  );
  if (typeof minted.token !== "string" || !minted.token) {
    throw new Error("GitHub App installation token was empty.");
  }
  return { token: minted.token, botLogin: `${app.slug}[bot]`, slug: app.slug };
}

export async function fetchAuthenticatedLogin(token, fetchImpl = fetch) {
  const user = await githubFetch(fetchImpl, "GET", "https://api.github.com/user", token);
  if (typeof user.login !== "string" || !user.login) {
    throw new Error("GitHub identity did not include a login.");
  }
  return user.login;
}
