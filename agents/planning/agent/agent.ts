import { defineAgent } from "eve";

const model =
  process.env.PLANNING_AGENT_MODEL ??
  process.env.SPECIFICATION_AGENT_MODEL ??
  "anthropic/claude-opus-5.5";

export default defineAgent({
  model,
  approval: ({ toolName }) => {
    if (
      toolName === "create_issue_plan_pull_request" ||
      toolName === "create_github_issues" ||
      toolName === "record_planning_baseline"
    ) {
      return "user-approval";
    }
    return undefined;
  },
});
