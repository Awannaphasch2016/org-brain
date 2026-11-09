import { defineAgent } from "eve";

const model =
  process.env.ARCHITECTURE_AGENT_MODEL ??
  process.env.SPECIFICATION_AGENT_MODEL ??
  "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (
      toolName === "create_architecture_pull_request" ||
      toolName === "record_architecture_baseline"
    ) {
      return "user-approval";
    }
    return undefined;
  },
});
