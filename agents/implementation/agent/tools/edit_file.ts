import { defineTool } from "eve/tools";
import { editFile } from "eve/tools/edit_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["implementation-report.md"];

export default defineTool({
  ...editFile,
  description: "Edit implementation files. The same limits as write_file apply.",
  async execute(input, ctx) {
    const decision = assessWrite(input.path, { allowedDocs, allowSrc: true });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await editFile.execute(input, ctx)) as { path: string; replacements: number };
  },
});
