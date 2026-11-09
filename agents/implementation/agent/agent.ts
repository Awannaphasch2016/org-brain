import { defineAgent } from "eve";

const model =
  process.env.IMPLEMENTATION_AGENT_MODEL ??
  process.env.SPECIFICATION_AGENT_MODEL ??
  "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (toolName === "create_implementation_pull_request" || toolName === "record_implementation_baseline") {
      return "user-approval";
    }
    return undefined;
  },
});
