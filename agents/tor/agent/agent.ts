import { defineAgent } from "eve";

const model = process.env.TOR_AGENT_MODEL ?? process.env.SPECIFICATION_AGENT_MODEL ?? "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (
      toolName === "create_project" ||
      toolName === "reject_project" ||
      toolName === "create_tor_pull_request" ||
      toolName === "record_tor_baseline"
    ) {
      return "user-approval";
    }
    return undefined;
  },
});
