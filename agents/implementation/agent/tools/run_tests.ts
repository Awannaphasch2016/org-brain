import { defineTool } from "eve/tools";
import { z } from "zod";
import { assertTestCommand } from "../../../../lib/implementation.mjs";

export default defineTool({
  description:
    "Run an allowlisted node test command inside the session sandbox. Refuses deploy, push, and network commands.",
  inputSchema: z.object({
    command: z.string().default("node --test"),
  }),
  async execute({ command }, ctx) {
    const allowed = assertTestCommand(command);
    const sandbox = await ctx.getSandbox();
    const result = await sandbox.run({ command: allowed });
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
});
