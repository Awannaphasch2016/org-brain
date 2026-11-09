import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["release-verification.md"];

export default defineTool({
  ...writeFile,
  description: "Write a release verification report. Refuses the TOR, source code, and fixtures.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath, { allowedDocs });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
