import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { assessWrite } from "../../../../lib/write-policy.mjs";

export default defineTool({
  ...writeFile,
  description:
    "Write a project draft under projects/<id>/docs. Refuses the frozen TOR, project.yaml, knowledge, and any path outside those drafts.",
  async execute(input, ctx) {
    const decision = assessWrite(input.filePath);
    if (!decision.allowed) throw new Error(decision.reason);
    return (await writeFile.execute(input, ctx)) as { existed: boolean; path: string };
  },
});
