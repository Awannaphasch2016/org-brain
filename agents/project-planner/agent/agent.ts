import { defineAgent } from "eve";

const model = process.env.PROJECT_PLANNER_MODEL ?? process.env.SPECIFICATION_AGENT_MODEL ?? "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
});
