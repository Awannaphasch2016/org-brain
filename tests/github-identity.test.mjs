import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createAppJwt, mintInstallationToken, normalizePrivateKey } from "../lib/github-app.mjs";
import { resolveGithubIdentityFromEnv, selectGithubCredentialSource } from "../lib/github-identity.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("app JWT is signed by the configured private key", () => {
  const now = Date.parse("2026-11-14T08:00:00.000Z");
  const token = createAppJwt({ appId: "12345", privateKey: pem, now });
  const [header, payload, signature] = token.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, "12345");
  assert.equal(claims.iat, Math.floor(now / 1000) - 60);
});

test("installation token mint uses the app JWT and returns the bot login", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization });
    if (url.endsWith("/app")) return json({ slug: "wewebplus-software-factory" });
    if (url.includes("/access_tokens")) return json({ token: "ghs_test_token" });
    return json({ message: "no" }, 404);
  };
  const minted = await mintInstallationToken({
    appId: "99",
    privateKey: pem.replace(/\n/g, "\\n"),
    installationId: "555",
    fetchImpl,
  });
  assert.equal(minted.token, "ghs_test_token");
  assert.equal(minted.botLogin, "wewebplus-software-factory[bot]");
  assert.equal(calls.length, 2);
  assert.match(calls[0].authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(calls[0].authorization.includes(pem), false);
});

test("private key newlines stored by an env file are restored", () => {
  const normalized = normalizePrivateKey(`"-----BEGIN PRIVATE KEY-----\\nline\\n-----END PRIVATE KEY-----"`);
  assert.match(normalized, /BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----/);
});

test("GitHub App credentials win over the connector and the personal token", async () => {
  const logs = [];
  let connectorCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith("/app")) return json({ slug: "factory" });
    if (url.includes("/access_tokens")) return json({ token: "ghs_app" });
    return json({ login: "should-not-be-used" });
  };
  const identity = await resolveGithubIdentityFromEnv({
    env: {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: pem,
      GITHUB_APP_INSTALLATION_ID: "2",
      GITHUB_CONNECTOR: "github/connector",
      GITHUB_TOKEN: "ghp_secret_pat",
    },
    fetchImpl,
    getConnectorToken: async () => {
      connectorCalls += 1;
      return "connector-token";
    },
    log: (line) => logs.push(line),
  });
  assert.equal(identity.kind, "github-app");
  assert.equal(identity.botLogin, "factory[bot]");
  assert.equal(identity.label, "github-app (factory[bot])");
  assert.equal(connectorCalls, 0);
  assert.match(logs[0], /kind=github-app login=factory\[bot\]/);
  assert.equal(logs.join("\n").includes("ghs_app"), false);
  assert.equal(logs.join("\n").includes("PRIVATE KEY"), false);
  assert.equal(logs.join("\n").includes("ghp_secret_pat"), false);
});

test("connector is used when the app env is absent, and the PAT remains the fallback", async () => {
  const connector = await resolveGithubIdentityFromEnv({
    env: { GITHUB_CONNECTOR: "github/connector", GITHUB_TOKEN: "ghp_pat" },
    fetchImpl: async () => json({ login: "connector[bot]" }),
    getConnectorToken: async () => "connector-token",
    log() {},
  });
  assert.equal(connector.kind, "github-connector");
  assert.equal(connector.botLogin, "connector[bot]");

  const pat = await resolveGithubIdentityFromEnv({
    env: { GITHUB_TOKEN: "ghp_pat" },
    fetchImpl: async () => json({ login: "Awannaphasch2016" }),
    log() {},
  });
  assert.equal(pat.kind, "personal-token");
  assert.equal(pat.label, "personal-token (Awannaphasch2016)");
});

test("FACTORY_REQUIRE_APP refuses the personal token, and a partial app env does not fall through", async () => {
  await assert.rejects(
    () => resolveGithubIdentityFromEnv({ env: { GITHUB_TOKEN: "ghp_pat", FACTORY_REQUIRE_APP: "1" }, log() {} }),
    /FACTORY_REQUIRE_APP=1/,
  );
  await assert.rejects(
    () => resolveGithubIdentityFromEnv({ env: { GITHUB_APP_ID: "1", GITHUB_TOKEN: "ghp_pat" }, log() {} }),
    /incomplete/,
  );
  assert.equal(selectGithubCredentialSource({}), "missing");
});

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(body);
    },
  };
}
