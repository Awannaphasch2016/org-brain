import { readFile } from "node:fs/promises";
import { GithubClient } from "../lib/github.mjs";
import { verifyApproval } from "../lib/owner-approval.mjs";

const [requestId, key, actionPath] = process.argv.slice(2);
if (!requestId || !key || !actionPath) {
  console.error("usage: node scripts/verify-approval.mjs <requestId> <key> <action.json>");
  process.exit(2);
}

const action = JSON.parse(await readFile(actionPath, "utf8"));
const slackToken = process.env.SLACK_BOT_TOKEN ?? "";
const slack = {
  async request(method, body) {
    if (!slackToken) return { ok: false };
    const response = await fetch("https://slack.com/api/conversations.replies", {
      method: "POST",
      headers: { authorization: `Bearer ${slackToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel: body.channel,
        ts: body.ts,
        oldest: body.oldest,
        latest: body.latest,
        inclusive: body.inclusive,
        limit: body.limit,
      }),
    });
    return response.json();
  },
};
const client = new GithubClient({
  token: process.env.GITHUB_TOKEN ?? "",
  owner: "Awannaphasch2016",
  repo: "org-brain",
  identity: { kind: "personal-token", botLogin: null },
});
const result = await verifyApproval({
  client,
  slack,
  action: { ...action, requestId: action.requestId ?? requestId, key: action.key ?? key },
});
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
