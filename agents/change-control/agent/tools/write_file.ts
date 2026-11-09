import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["change-review.md", "change-validation.md", "srs.md"];

export default defineTool({
  ...writeFile,
  description: "Write a change review or a revised SRS. Refuses the frozen TOR and fixtures.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath, { allowedDocs });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
