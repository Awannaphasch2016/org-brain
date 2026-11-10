import { defineAgent } from "eve";

const model =
  process.env.RELEASE_AGENT_MODEL ??
  process.env.SPECIFICATION_AGENT_MODEL ??
  "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (toolName === "prepare_release" || toolName === "deploy_application") {
      return "user-approval";
    }
    return undefined;
  },
});
