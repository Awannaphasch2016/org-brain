import { defineTool } from "eve/tools";
import { editFile } from "eve/tools/edit_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

const allowedDocs = ["release-verification.md"];

export default defineTool({
  ...editFile,
  description: "Edit a release verification report. The same limits as write_file apply.",
  async execute(input, ctx) {
    const decision = assessWrite(input.path, { allowedDocs });
    if (!decision.allowed) throw new Error(decision.reason);
    return (await editFile.execute(input, ctx)) as { path: string; replacements: number };
  },
});
