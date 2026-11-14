import { defineAgent } from "eve";

const model = process.env.TOR_AGENT_MODEL ?? process.env.SPECIFICATION_AGENT_MODEL ?? "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (toolName === "create_project" || toolName === "reject_project") return "user-approval";
    return undefined;
  },
});
