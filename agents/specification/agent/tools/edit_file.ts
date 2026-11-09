import { defineTool } from "eve/tools";
import { editFile } from "eve/tools/edit_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  ...editFile,
  description:
    "Edit a project draft under projects/<id>/docs. The same path limits as write_file apply, including the frozen TOR.",
  async execute(input, ctx) {
    const decision = assessWrite(input.path);
    if (!decision.allowed) throw new Error(decision.reason);
    return (await editFile.execute(input, ctx)) as { path: string; replacements: number };
  },
});
