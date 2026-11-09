export function assertTestCommand(command: string): string;
export function runLocalTests(cwd: string, command?: string): {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};
export function planImplementationPullRequest(input: {
  fixture: boolean;
  testsOk: boolean;
  projectId: string;
  files: readonly { path: string }[];
}): { ok: true; paths: string[] } | { ok: false; error: string };
