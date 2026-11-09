import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["implementation-report.md"];

export default defineTool({
  ...writeFile,
  description: "Write implementation files under projects/<id>/src or tests, plus the implementation report. Refuses the TOR and fixtures.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath, { allowedDocs, allowSrc: true });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
