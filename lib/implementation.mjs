import { spawnSync } from "node:child_process";

const ALLOWED_TEST = /^node --test(?: [\w./-]+)?$/;

export function assertTestCommand(command) {
  if (typeof command !== "string" || !ALLOWED_TEST.test(command)) {
    throw new Error("test command is not allowlisted");
  }
  if (/curl|wget|deploy|git\s+push|vercel|rm\s|sudo|ssh/i.test(command)) {
    throw new Error("test command is not allowlisted");
  }
  return command;
}

export function runLocalTests(cwd, command = "node --test tests") {
  assertTestCommand(command);
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function planImplementationPullRequest({ fixture, testsOk, projectId, files }) {
  if (fixture) {
    return { ok: false, error: "Refusing to open a project pull request from a fixture." };
  }
  if (!testsOk) {
    return { ok: false, error: "Refusing to open a pull request while tests are failing." };
  }
  const paths = [];
  for (const file of files) {
    const path = String(file.path).replace(/\\/g, "/");
    if (path.includes("fixtures/") || /(?:^|\/)docs\/tor\.md$/.test(path)) {
      return { ok: false, error: "Refusing to commit a fixture or the frozen TOR." };
    }
    const prefix = `projects/${projectId}/`;
    if (!path.startsWith(prefix)) return { ok: false, error: `Refusing to commit ${path}` };
    const rest = path.slice(prefix.length);
    if (!/^(?:src|tests)\/[^/].+/.test(rest) && rest !== "docs/implementation-report.md") {
      return { ok: false, error: `Refusing to commit ${path}` };
    }
    paths.push(path);
  }
  return { ok: true, paths };
}
