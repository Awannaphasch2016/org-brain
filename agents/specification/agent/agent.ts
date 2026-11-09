import { defineAgent } from "eve";

const model = process.env.SPECIFICATION_AGENT_MODEL ?? "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  // Omit reasoning so the gateway model keeps its provider default.
  // Claude Opus 5.5 uses adaptive thinking; do not force it off.
  approval: ({ toolName }) => {
    if (toolName === "create_srs_pull_request" || toolName === "record_srs_baseline") {
      return "user-approval";
    }
    return undefined;
  },
});
