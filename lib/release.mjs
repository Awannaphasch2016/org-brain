export const DEPLOY_DISABLED =
  "Prototype 6 does not deploy the application. No deploy request is sent.";

const DEPLOY_URL = /vercel\.com|\/v13\/deployments|\/deployments/i;

export function verifyAcceptance({ evidence = "", torUnchanged }) {
  const errors = [];
  if (!/^Tests:\s*pass\s*$/im.test(evidence)) errors.push("evidence does not show passing tests");
  if (!/^Implementation baseline:\s*\S+/im.test(evidence)) {
    errors.push("evidence does not name an implementation baseline");
  }
  if (torUnchanged !== true) errors.push("the frozen TOR must be unchanged");
  if (/^Deployed:\s*true\s*$/im.test(evidence)) {
    errors.push("evidence claims a deployment that this prototype does not perform");
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    report: [
      "# Release verification report",
      "",
      `Result: ${ok ? "pass" : "fail"}`,
      "",
      "Deployment: not executed",
      "",
      DEPLOY_DISABLED,
      "",
      "## Errors",
      "",
      ...(errors.length ? errors.map((error) => `- ${error}`) : ["- none"]),
      "",
    ].join("\n"),
  };
}

export function planRelease({ fixture, verificationOk }) {
  if (fixture) {
    return {
      ok: false,
      deploy: false,
      requests: [],
      error: "Refusing to record a release baseline from a fixture.",
    };
  }
  if (!verificationOk) {
    return {
      ok: false,
      deploy: false,
      requests: [],
      error: "Refusing to open a release pull request while verification fails.",
    };
  }
  return { ok: true, deploy: false, requests: [], reason: DEPLOY_DISABLED };
}

export function deployApplication({ approved }) {
  if (!approved) {
    return { deployed: false, requests: [], reason: "human approval is required before a release record" };
  }
  return { deployed: false, requests: [], reason: DEPLOY_DISABLED };
}

export function assertNoDeployRequest(url) {
  if (DEPLOY_URL.test(String(url))) throw new Error(DEPLOY_DISABLED);
}
