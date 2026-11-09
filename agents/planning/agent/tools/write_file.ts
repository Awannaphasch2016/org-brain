import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["feature-issues.md", "issues-validation.md", "_analysis.md"];

export default defineTool({
  ...writeFile,
  description: "Write a feature-issue draft under projects/<id>/docs. Refuses the TOR, fixtures, and knowledge.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath, { allowedDocs });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
