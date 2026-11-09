import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["architecture.md", "architecture-validation.md", "_analysis.md"];

export default defineTool({
  ...writeFile,
  description: "Write an architecture draft under projects/<id>/docs. Refuses the TOR, the SRS, fixtures, and knowledge.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath, { allowedDocs });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
