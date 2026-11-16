# Agent ownership

Anak approves every guideline change, directly (PR review/merge) or through Grokbot as his authorized representative on his explicit approval; agents never approve their own guideline changes.

Roles named here: Spec Writer Agent, Coding Agent, Grokbot, and Anak.

Phase 4 and later agents are not covered.

## TOR

| Paths | Gate stages | Tools | Slack access |
| --- | --- | --- | --- |
| projects/<id>/docs/tor.md | setup, tor | ask_question, create_project, create_tor_pull_request, edit_file, get_pr_status, glob, grep, load_tor_workspace, no_reply, read_file, record_tor_baseline, reject_project, validate_intake, write_file | allowedUserIds and allowedChannelIds in generated/config.ts; gate approvers are FACTORY_GATE_APPROVER_IDS |
| projects/<id>/docs/elicitation-log.md | | | |

## Project Planner

| Paths | Gate stages | Tools | Slack access |
| --- | --- | --- | --- |
| projects/<id>/docs/project-plan.md | project-plan | ask_question, create_project_plan_pull_request, edit_file, get_pr_status, glob, grep, load_plan_workspace, no_reply, read_file, record_project_plan_baseline, validate_project_plan, write_file | allowedUserIds and allowedChannelIds in generated/config.ts; gate approvers are FACTORY_GATE_APPROVER_IDS |

## Specification

| Paths | Gate stages | Tools | Slack access |
| --- | --- | --- | --- |
| projects/<id>/docs/srs.md | srs | agent, ask_question, create_srs_pull_request, edit_file, get_pr_status, glob, grep, load_project, no_reply, record_srs_baseline, validate_srs, web_fetch, web_search, write_file | allowedUserIds and allowedChannelIds in generated/config.ts; gate approvers are FACTORY_GATE_APPROVER_IDS |
| projects/<id>/docs/traceability.md | | | |
